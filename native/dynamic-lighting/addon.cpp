#include <node_api.h>
#include <windows.h>
#include <winrt/base.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Devices.Lights.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.UI.h>

#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <future>
#include <iomanip>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using winrt::Windows::Devices::Enumeration::DeviceInformation;
using winrt::Windows::Devices::Lights::LampArray;
using winrt::Windows::UI::Color;

namespace {

struct DeviceRecord {
  std::string id;
  std::string name;
  uint32_t lampCount{};
  double minUpdateIntervalMs{};
  bool available{};
};

std::string ToUtf8(const winrt::hstring& value) {
  return winrt::to_string(value);
}

winrt::hstring ToHString(const std::string& value) {
  return winrt::to_hstring(value);
}

std::string JsonEscape(const std::string& value) {
  std::ostringstream out;
  for (unsigned char c : value) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec;
        } else {
          out << c;
        }
    }
  }
  return out.str();
}

Color ParseColor(const std::string& raw) {
  std::string hex = raw;
  if (!hex.empty() && hex.front() == '#') hex.erase(hex.begin());
  if (hex.size() == 3) {
    std::string expanded;
    expanded.reserve(6);
    for (char c : hex) {
      expanded.push_back(c);
      expanded.push_back(c);
    }
    hex = expanded;
  }
  if (hex.size() != 6) hex = "000000";
  auto byteAt = [&](size_t offset) -> uint8_t {
    return static_cast<uint8_t>(std::stoul(hex.substr(offset, 2), nullptr, 16));
  };
  return Color{255, byteAt(0), byteAt(2), byteAt(4)};
}

class LightingController {
 public:
  LightingController() : worker_([this] { Run(); }) {}

  ~LightingController() { Stop(); }

  std::vector<DeviceRecord> Scan() {
    return Invoke([this] {
      devices_.clear();
      std::vector<DeviceRecord> result;
      auto infos = DeviceInformation::FindAllAsync(LampArray::GetDeviceSelector()).get();
      for (const auto& info : infos) {
        try {
          auto lamp = LampArray::FromIdAsync(info.Id()).get();
          if (!lamp) continue;
          const auto id = ToUtf8(info.Id());
          devices_.emplace(id, lamp);
          result.push_back(DeviceRecord{
            id,
            ToUtf8(info.Name()).empty() ? "Dynamic Lighting Device" : ToUtf8(info.Name()),
            static_cast<uint32_t>(lamp.LampCount()),
            lamp.MinUpdateInterval().count() / 10000.0,
            lamp.IsAvailable()
          });
        } catch (...) {
        }
      }
      return result;
    });
  }

  std::vector<DeviceRecord> Availability() {
    return Invoke([this] {
      std::vector<DeviceRecord> result;
      result.reserve(devices_.size());
      for (const auto& [id, lamp] : devices_) {
        result.push_back(DeviceRecord{
          id,
          "",
          static_cast<uint32_t>(lamp.LampCount()),
          lamp.MinUpdateInterval().count() / 10000.0,
          lamp.IsAvailable()
        });
      }
      return result;
    });
  }

  bool SetAll(const std::string& color, double brightness) {
    return Invoke([this, color, brightness] {
      const auto parsed = ParseColor(color);
      const auto level = std::clamp(brightness, 0.0, 1.0);
      for (auto& [_, lamp] : devices_) {
        lamp.BrightnessLevel(level);
        lamp.SetColor(parsed);
      }
      return true;
    });
  }

  bool SetDevice(const std::string& id, const std::string& color, double brightness) {
    return Invoke([this, id, color, brightness] {
      auto it = devices_.find(id);
      if (it == devices_.end()) return false;
      it->second.BrightnessLevel(std::clamp(brightness, 0.0, 1.0));
      it->second.SetColor(ParseColor(color));
      return true;
    });
  }

  bool SetLeds(const std::string& id, const std::vector<std::string>& colors, double brightness) {
    return Invoke([this, id, colors, brightness] {
      auto it = devices_.find(id);
      if (it == devices_.end()) return false;
      auto& lamp = it->second;
      const uint32_t count = std::min<uint32_t>(lamp.LampCount(), static_cast<uint32_t>(colors.size()));
      if (count == 0) return true;
      std::vector<Color> nativeColors;
      std::vector<int32_t> indices;
      nativeColors.reserve(count);
      indices.reserve(count);
      for (uint32_t i = 0; i < count; ++i) {
        nativeColors.push_back(ParseColor(colors[i]));
        indices.push_back(static_cast<int32_t>(i));
      }
      lamp.BrightnessLevel(std::clamp(brightness, 0.0, 1.0));
      lamp.SetColorsForIndices(nativeColors, indices);
      return true;
    });
  }

  void Release() {
    Invoke([this] {
      devices_.clear();
      return true;
    });
  }

  void Stop() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_) return;
      stopping_ = true;
    }
    cv_.notify_one();
    if (worker_.joinable()) worker_.join();
  }

 private:
  template <typename Fn>
  auto Invoke(Fn&& fn) -> decltype(fn()) {
    using Result = decltype(fn());
    auto task = std::make_shared<std::packaged_task<Result()>>(std::forward<Fn>(fn));
    auto future = task->get_future();
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_) throw std::runtime_error("Dynamic Lighting controller is stopped.");
      tasks_.emplace_back([task] { (*task)(); });
    }
    cv_.notify_one();
    return future.get();
  }

  void Run() {
    try {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      while (true) {
        std::function<void()> task;
        {
          std::unique_lock<std::mutex> lock(mutex_);
          cv_.wait(lock, [this] { return stopping_ || !tasks_.empty(); });
          if (stopping_ && tasks_.empty()) break;
          task = std::move(tasks_.front());
          tasks_.pop_front();
        }
        task();
      }
      devices_.clear();
      winrt::uninit_apartment();
    } catch (...) {
      std::lock_guard<std::mutex> lock(mutex_);
      stopping_ = true;
    }
  }

  std::thread worker_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<std::function<void()>> tasks_;
  std::map<std::string, LampArray> devices_;
  bool stopping_{false};
};

LightingController& Controller() {
  static LightingController controller;
  return controller;
}

void ThrowLast(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::string result(length + 1, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size(), &length);
  result.resize(length);
  return result;
}

double GetDouble(napi_env env, napi_value value) {
  double result = 0;
  napi_get_value_double(env, value, &result);
  return result;
}

napi_value MakeBoolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value Scan(napi_env env, napi_callback_info info) {
  try {
    const auto devices = Controller().Scan();
    napi_value result;
    napi_create_object(env, &result);
    napi_value ok;
    napi_get_boolean(env, true, &ok);
    napi_set_named_property(env, result, "ok", ok);
    napi_value supported;
    napi_get_boolean(env, true, &supported);
    napi_set_named_property(env, result, "supported", supported);
    napi_value array;
    napi_create_array_with_length(env, devices.size(), &array);
    for (size_t i = 0; i < devices.size(); ++i) {
      const auto& device = devices[i];
      napi_value item;
      napi_create_object(env, &item);
      napi_value id;
      napi_create_string_utf8(env, device.id.c_str(), NAPI_AUTO_LENGTH, &id);
      napi_set_named_property(env, item, "id", id);
      napi_value name;
      napi_create_string_utf8(env, device.name.c_str(), NAPI_AUTO_LENGTH, &name);
      napi_set_named_property(env, item, "name", name);
      napi_value lampCount;
      napi_create_uint32(env, device.lampCount, &lampCount);
      napi_set_named_property(env, item, "lampCount", lampCount);
      napi_value minUpdate;
      napi_create_double(env, device.minUpdateIntervalMs, &minUpdate);
      napi_set_named_property(env, item, "minUpdateIntervalMs", minUpdate);
      napi_value perLed;
      napi_get_boolean(env, device.lampCount > 1, &perLed);
      napi_set_named_property(env, item, "supportsPerLed", perLed);
      napi_value available;
      napi_get_boolean(env, device.available, &available);
      napi_set_named_property(env, item, "available", available);
      napi_set_element(env, array, static_cast<uint32_t>(i), item);
    }
    napi_set_named_property(env, result, "devices", array);
    return result;
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value Availability(napi_env env, napi_callback_info info) {
  try {
    const auto devices = Controller().Availability();
    napi_value array;
    napi_create_array_with_length(env, devices.size(), &array);
    for (size_t i = 0; i < devices.size(); ++i) {
      const auto& device = devices[i];
      napi_value item;
      napi_create_object(env, &item);
      napi_value id;
      napi_create_string_utf8(env, device.id.c_str(), NAPI_AUTO_LENGTH, &id);
      napi_set_named_property(env, item, "id", id);
      napi_value available;
      napi_get_boolean(env, device.available, &available);
      napi_set_named_property(env, item, "available", available);
      napi_set_element(env, array, static_cast<uint32_t>(i), item);
    }
    return array;
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value SetAll(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    ThrowLast(env, "setAll requires color and brightness.");
    return nullptr;
  }
  try {
    return MakeBoolean(env, Controller().SetAll(GetString(env, argv[0]), GetDouble(env, argv[1])));
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value SetDevice(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    ThrowLast(env, "setDevice requires id, color, and brightness.");
    return nullptr;
  }
  try {
    return MakeBoolean(env, Controller().SetDevice(GetString(env, argv[0]), GetString(env, argv[1]), GetDouble(env, argv[2])));
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value SetLeds(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    ThrowLast(env, "setLeds requires id, colors, and brightness.");
    return nullptr;
  }
  try {
    uint32_t length = 0;
    napi_get_array_length(env, argv[1], &length);
    std::vector<std::string> colors;
    colors.reserve(length);
    for (uint32_t i = 0; i < length; ++i) {
      napi_value item;
      napi_get_element(env, argv[1], i, &item);
      colors.push_back(GetString(env, item));
    }
    return MakeBoolean(env, Controller().SetLeds(GetString(env, argv[0]), colors, GetDouble(env, argv[2])));
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value Release(napi_env env, napi_callback_info info) {
  try {
    Controller().Release();
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
  } catch (const std::exception& ex) {
    ThrowLast(env, ex.what());
    return nullptr;
  }
}

napi_value HasPackageIdentity(napi_env env, napi_callback_info info) {
  using GetCurrentPackageFullNameFn = LONG(WINAPI*)(UINT32*, PWSTR);
  const auto kernel32 = GetModuleHandleW(L"kernel32.dll");
  const auto function = kernel32
    ? reinterpret_cast<GetCurrentPackageFullNameFn>(GetProcAddress(kernel32, "GetCurrentPackageFullName"))
    : nullptr;
  if (!function) return MakeBoolean(env, false);
  UINT32 length = 0;
  const LONG status = function(&length, nullptr);
  return MakeBoolean(env, status == ERROR_INSUFFICIENT_BUFFER || status == ERROR_SUCCESS);
}

napi_value Shutdown(napi_env env, napi_callback_info info) {
  Controller().Stop();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"scan", nullptr, Scan, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"availability", nullptr, Availability, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAll", nullptr, SetAll, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setDevice", nullptr, SetDevice, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setLeds", nullptr, SetLeds, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"release", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"hasPackageIdentity", nullptr, HasPackageIdentity, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"shutdown", nullptr, Shutdown, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
