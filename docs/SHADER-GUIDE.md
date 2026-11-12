# Shader authoring guide

How to write a visualizer or a background for the **Studio** page: what your code receives, how
sliders are declared, how feedback and multi-pass shaders work, and how Shadertoy and ISF files
come in. Everything here is taken from the shader host,
[`src/visualizer/modes/shaderhost.js`](../src/visualizer/modes/shaderhost.js).

## The shape of a shader

A Studio shader is a WebGL2 (GLSL ES 3.00) fragment shader with one entry point:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / sv_resolution;          // 0..1, origin bottom-left
  vec3 col = sv_col(uv.x) * sv_spec(uv.x);       // palette color, scaled by the spectrum
  fragColor = vec4(col, 1.0);
}
```

You do not write `#version`, `precision`, `main()` or the uniform declarations; the host adds them.
`fragCoord` is in pixels. The same code runs in the output window, the panel preview, the OBS
overlay and the video exporter.

Open **Studio → Shader**, pick any built-in preset, and edit: the preview recompiles as you type.
A compile error is shown under the editor with the line number in **your** code. **Save** keeps
your copy; **Use In Scene** puts it on a layer. A built-in preset is never overwritten: saving
creates your own copy.

**Type** decides where the preset appears: a **Visualizer** is drawn over the background and
should leave the rest transparent, a **Background** fills the frame.

## What your code receives

### Time and size

| Name | Type | Meaning |
|---|---|---|
| `sv_resolution` | `vec2` | Canvas size in pixels (`iResolution.xy`) |
| `sv_time` | `float` | Seconds since the shader started (`iTime`) |
| `iResolution` | `vec3` | Shadertoy name for the size |
| `iTime`, `iTimeDelta`, `iFrame` | `float`, `float`, `int` | Shadertoy clock, frame time and frame counter |
| `iMouse` | `vec4` | Declared for compatibility; always zero |

In a video export the clock is the frame's own time, so a shader that only depends on `sv_time` and
the audio values renders the same video every time.

### Audio

| Name | Type | Range | Meaning |
|---|---|---|---|
| `sv_level` | `float` | 0..1 | Overall level |
| `sv_bass`, `sv_mid`, `sv_treble` | `float` | 0..1 | Three bands |
| `sv_beat` | `float` | 0..1 | Jumps on a beat, then decays over about a third of a second |
| `sv_spec(x)` | `float` | 0..1 | Logarithmic spectrum at position `x` (0 = low, 1 = high) |
| `sv_waveAt(x)` | `float` | −1..1 | Waveform at position `x` across the buffer |

`sv_spec` and `sv_waveAt` read two 512-pixel textures, `sv_spectrum` and `sv_wave`. You can sample
them directly if you want filtering of your own.

### Color

`sv_col(x)` returns a color from the scene's five-color palette, blended along `x` in 0..1. Using
it instead of fixed colors makes your shader follow **Color Theme**, the album-art colors and every
palette change in a show. The raw colors are in `sv_palette[0]` … `sv_palette[4]`.

`sv_hueRotate(color, angle)` rotates a color's hue by an angle in radians.

### Pictures

| Sampler | Shadertoy name | What it holds |
|---|---|---|
| `sv_spectrum` | `iChannel0` | The spectrum, 512×1 |
| `sv_wave` | `iChannel1` | The waveform, 512×1 |
| `sv_prev` | `iChannel2` | Your own previous frame (feedback) |
| `sv_media` | `iChannel3` | The scene's media layer: webcam, video file, screen |

`texture2D(...)` is accepted and means `texture(...)`.

## Transparency

The host uses straight (not premultiplied) alpha. A visualizer should write a low alpha where the
layers underneath are meant to show:

```glsl
float glow = smoothstep(0.02, 0.0, abs(uv.y - 0.5 - 0.3 * sv_waveAt(uv.x)));
fragColor = vec4(sv_col(uv.x) * glow, min(1.0, glow));
```

A background normally writes `1.0`.

## Sliders, colors and switches

**Add Parameter** under the preview declares a control. Each one becomes a uniform with the name
you give it, and a control in the panel:

| Control | GLSL type | Notes |
|---|---|---|
| Slider | `float` | minimum, maximum, step and default are yours to set |
| Color | `vec3` | 0..1 per channel |
| Switch | `bool` | |

Use the name directly in your code; do not declare the uniform yourself. The built-in presets use a
`u` prefix (`uScale`, `uSpeed`, `uWarp`), which keeps parameters easy to spot. The icon next to a
slider edits its definition: name, range, step and default.

## Feedback

Reading `sv_prev` gives you the frame you drew last time. That is all a trail, an echo or a
reaction-diffusion effect needs:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / sv_resolution;
  vec2 c = uv - 0.5;
  vec3 prev = texture(sv_prev, 0.5 + c * (0.99 - 0.02 * sv_bass)).rgb * 0.96;   // zoom and fade
  float ring = smoothstep(0.012, 0.0, abs(length(c) - 0.15 - 0.2 * sv_beat));
  fragColor = vec4(prev + sv_col(fract(sv_time * 0.05)) * ring, 1.0);
}
```

The feedback buffer is only created when your code mentions `sv_prev` (or `iChannel2`), so a shader
without feedback does not pay for it.

## Several passes

Split the code with marker comments when one pass is not enough:

```glsl
//@common
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }

//@pass A
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / sv_resolution;
  vec3 prev = texture(sv_prev, uv).rgb * 0.97;          // this buffer's own last frame
  fragColor = vec4(prev + step(0.995, hash(uv + sv_time)) * sv_beat, 1.0);
}

//@pass image
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / sv_resolution;
  fragColor = vec4(texture(sv_bufA, uv).r * sv_col(uv.x), 1.0);
}
```

- `//@common` is added to the top of every pass.
- `//@pass A` … `//@pass D` are buffers, at most four, drawn in that order. Each keeps its previous
  frame, and uses half-float storage where the GPU allows.
- `//@pass image` is the pass that reaches the screen. It is required.
- A pass reads the buffers through `sv_bufA` … `sv_bufD`. It sees **this** frame of the buffers
  drawn before it and the **previous** frame of itself and of the ones after it.
- In a buffer pass, `sv_prev` is that buffer's own previous frame.
- `channels=` rewires `iChannel0`–`3` for one pass, which lets multi-buffer code from elsewhere be
  pasted pass by pass: `//@pass image channels=A,B,wave,media`. The names are `spectrum`, `wave`,
  `prev` (or `self`), `media`, `A`, `B`, `C`, `D`; the default is `spectrum, wave, prev, media`.

Code without markers is a single pass, exactly as before.

## Bringing code in

**Import** in Studio's preset list reads a file and converts it on your computer. No service is
contacted.

**Shadertoy.** Paste or import code that has `mainImage`. The channels are bound as in the table
above (spectrum, waveform, previous frame, media), so a shader written for a music input on
`iChannel0` reacts to your audio straight away. `iDate`, `iSampleRate`, `iFrameRate` and
`iChannelResolution` are defined as constants. Multi-buffer shaders come in pass by pass with the
markers above. Cube maps, volumes, keyboard input and the Sound tab have no equivalent.

**ISF.** A file with the JSON header is recognised by itself. Inputs map like this:

| ISF input | Becomes |
|---|---|
| `float`, `long` | a slider (`long` in whole steps), with `MIN`, `MAX` and `DEFAULT` |
| `bool` | a switch |
| `color` | a color (alpha is dropped) |
| `point2D` | two sliders, `NAME_x` and `NAME_y`, 0..1 |
| `image` | the media layer |

`RENDERSIZE`, `TIME`, `isf_FragNormCoord` and the `IMG_PIXEL` family are defined, and `PASSES` with
targets become real buffer passes. `event`, `audio` and `audioFFT` inputs are not mapped; use
`sv_beat`, `sv_waveAt` and `sv_spec` instead.

**Your own files.** **Export** writes a preset as `.svpreset`; several presets travel together as a
`.svpack`. Both carry the code, the parameters and the description.

## Keeping it fast

A shader runs once per pixel per frame, on every output.

- The cost is roughly *pixels × loop iterations*. A raymarcher with 96 steps at 4K is about nine
  times the work of the same shader at 1080p with 48 steps. Give step counts a slider.
- Avoid loops whose length depends on a uniform that can grow without limit.
- Each buffer pass is another full-screen draw. Use one only when the effect needs memory.
- Measure: `npm run bench -- --only=<part of the name>` draws a scene in the real page and reports
  frame time; see [BENCHMARKS.md](BENCHMARKS.md). **Output → Power / Performance → Adaptive
  Resolution** lowers the render size by itself when a scene cannot hold the frame rate.

## A complete example

A bar spectrum that follows the palette, glows on the beat and leaves the background visible.
Add one slider named `uBars` (minimum 8, maximum 96, step 1, default 48), set **Type** to
Visualizer, and paste:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / sv_resolution;
  float n = floor(uBars);
  float i = floor(uv.x * n);                    // which bar
  float x = fract(uv.x * n);                    // position inside the bar
  float h = sv_spec((i + 0.5) / n) * 0.8;       // its height
  float body = step(0.12, x) * step(x, 0.88) * step(uv.y, h);
  float cap = smoothstep(0.02, 0.0, abs(uv.y - h)) * step(0.12, x) * step(x, 0.88);
  vec3 col = sv_col(i / n) * (0.7 + 0.6 * sv_beat);
  float a = clamp(body * 0.9 + cap, 0.0, 1.0);
  fragColor = vec4(col * a, a);
}
```
