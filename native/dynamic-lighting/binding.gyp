{
  "targets": [
    {
      "target_name": "dynamic_lighting",
      "sources": ["addon.cpp"],
      "defines": ["NAPI_VERSION=9", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20", "/EHsc", "/permissive-"]
        },
        "VCLinkerTool": {
          "AdditionalDependencies": ["windowsapp.lib"]
        }
      }
    }
  ]
}
