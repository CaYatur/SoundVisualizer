# Modulation cookbook

Recipes you can copy into the **Modulation** panel. Each one is a handful of settings; none needs
code. The behavior described here is the route evaluator in
[`src/shared/modulation.js`](../src/shared/modulation.js).

## How a route works

Open the **Scene** page, switch the shelf to the tools (the second icon) and choose **Modulation**.
**+ Add Route** creates a route. A route reads a **Source** every frame and writes a **Target**.

| Field | What it does |
|---|---|
| **Source** | The signal: audio bands, beat, LFOs, envelopes, custom bands, sequencers, macros, analysis values |
| **Target** | The setting to drive. Grouped: Visualizer, Background (one group per mode), 3D Geometry, Logo, each effect in the chain, and each layer's opacity, scale, rotation and position |
| **Mode** | **Set Value** moves the setting between Min and Max. **Add** adds up to (Max − Min) on top of the value you set by hand. **Multiply** scales your value between (1 − Amount) and (1 + Amount) times itself |
| **Curve** | Shapes the source before it is used: Linear, Exponential, Exponential (strong), Logarithmic, S-Curve, Eased, Absolute |
| **Amount** | How strongly the route acts. At 0 the setting stays where you put it |
| **Min**, **Max** | The range the source is mapped onto. The result never leaves it, in any mode. Choosing a target fills them with that setting's own range |
| **Smoothing** | Slows the response, so a jumpy source becomes a glide |
| **Steps** | Quantises the source into that many levels (2 = on / off) |
| **Invert** | Flips the source: loud becomes low |

Two things to keep in mind:

- The source is a number from 0 to 1 (LFOs can be bipolar and are brought into 0..1 first). The
  curve is applied to that number, then Invert, then Steps, then Smoothing.
- Because the result is kept inside Min..Max, an **Add** route needs Min at (or below) your own
  value and Max above it. With Min 1 and Max 1.3 on a scale of 1, the route adds up to 0.3.
- Modulation never changes your saved settings. The slider in the inspector keeps the value you
  set; the route moves the picture only. Turn **Modulation Enabled** off and everything is back.

The **Live** meter at the top of each route shows the source as it is now. If it does not move, the
route cannot do anything: check the source before adjusting the rest.

## 1. Kick-driven punch

The picture jumps on every bass drum and settles between hits.

| Field | Value |
|---|---|
| Source | **Analysis → Bass Drum** (or **Audio → Beat (trigger)** when deep analysis is off) |
| Target | The visualizer layer's **Scale** (group *Layer N · name*) |
| Mode | Add |
| Curve | Exponential |
| Min / Max | your scale (for example 1) / 0.3 more (1.3) |
| Amount | 1 |
| Smoothing | a little, so the return is soft |

The layer rests at the size you chose and grows by up to 30% on a hit. Raise **Max** for a harder
punch. For a zoom into the whole frame, add a **Zoom Blur** effect to the chain and target
its strength instead of the layer.

## 2. Bass opens the glow

Quiet passages stay clean; loud bass blooms.

| Field | Value |
|---|---|
| Source | **Audio → Bass** |
| Target | **Bloom → Intensity** (add *Bloom* to the Effect Chain first; it then appears as a group) |
| Mode | Set Value |
| Curve | Exponential (strong) |
| Min / Max | 0.2 / 1.4 |
| Smoothing | medium |

The strong curve ignores small bass and reacts to peaks. If the glow flickers, raise Smoothing.

## 3. Slow drift that never repeats the song

A background that keeps moving in a calm scene, independent of the music.

1. Open **LFOs** in the Modulation panel. Set **LFO 1** to **Sine**, turn **Sync to Tempo** on and
   choose a long division such as 8 bars.
2. Add a route: Source **LFO 1**, Target the background layer's **Rotation**, Mode **Set Value**,
   Min −8, Max 8, Amount 1. The layer swings eight degrees each way.
3. Add a second route from **LFO 2** (Triangle, a different division such as 4 bars) to the same
   layer's **Horizontal** position, Mode **Set Value**, Min −0.03, Max 0.03.

Two LFOs with different lengths take many bars to line up again, so the motion does not read as a
loop. Because LFO phase comes from the draw clock, a video export shows exactly the same drift.

## 4. One knob for intensity

A single fader that takes the scene from calm to full.

1. Name **Macro 1** "Intensity".
2. Add three routes, all with Source **Macro 1**:

   | Target | Mode | Min / Max |
   |---|---|---|
   | Visualizer → **Sensitivity** | Set Value | your calm value / your full value |
   | Bloom → **Intensity** | Set Value | 0.1 / 1.2 |
   | Background → your mode's **Bass Push** | Set Value | 0 / 2 |

3. Map a MIDI fader to the macro (**Setup → Control → MIDI Controller**, **Learn**).

Macros are the right thing to put on hardware: one physical control, many settings, and the ranges
are yours.

## 5. Hi-hats sparkle, snares flash

Different drums drive different things, so the picture reads the rhythm.

| Route | Source | Target | Mode | Notes |
|---|---|---|---|---|
| A | **Analysis → Hi-Hat** | Background → Starfield → **Twinkle** | Add | Min at your value, Max a little above; no smoothing |
| B | **Analysis → Snare** | the visualizer layer's **Opacity** | Multiply | Amount 0.3: the layer rests at 70% and is full on a snare |

The drum sources need deep analysis (**Setup → Audio → Deep Analysis**). Without it, use
**Custom Bands**: set one band to roughly 6–12 kHz for hats and another to 150–250 Hz for the snare
body, and pick them from the **Custom Band** group.

## 6. Harmony changes the color

The palette follows the music's key instead of the clock.

| Field | Value |
|---|---|
| Source | **Analysis → Chord Root** (or **Key**) |
| Target | Background → Fluid Gradient → **Audio Hue**, or the logo's **Hue** |
| Mode | Set Value |
| Steps | 12 |
| Smoothing | high |

*Steps 12* gives each pitch class its own value; high smoothing makes the change a slow turn
instead of a cut. On music without clear harmony (drums only, noise) the source wanders; lower
**Amount** so the color moves less.

## 7. A rhythm of your own

A pattern that is locked to the tempo but is not the kick.

1. Open **Step Sequencers** and draw a pattern in **Sequencer 1**: each step's height is its value.
   Choose the **Division** (for example 1/8) and a little **Glide** if the steps should slide.
2. Route **Sequencer 1** to anything: a layer's **Opacity** (Mode Multiply) for a gated look, or an
   effect's strength for a rhythmic accent.

## 8. Calm when it is quiet

Everything slows down in a breakdown and comes back with the drop.

| Field | Value |
|---|---|
| Source | **Envelope 1**, with **Source Band** = Overall, a short **Attack** and a long **Release** |
| Target | Background → your mode's **Speed** |
| Mode | Multiply |
| Amount | 0.6 |

The speed moves between 40% and 160% of the value you set. The envelope follower rises quickly
and falls slowly, so it does not chatter with every note. The same envelope can feed a second route to the visualizer's **Sensitivity**.

## When a route does nothing

- **The Live meter is flat.** The source has no signal: deep-analysis sources need Deep Analysis
  on; an LFO with a very long period looks still.
- **The target is not in the scene.** A background mode's settings only matter while a layer uses
  that mode. An effect's group only exists while the effect is in the chain.
- **Min and Max are equal**, or **Amount** is 0.
- **Another route wins.** Routes are applied in order; a later *Set Value* on the same target
  replaces an earlier one. Use *Add* or *Multiply* to combine.
- **Modulation Enabled** is off.

See also the [user guide](GUIDE.md) and the
[modulation section](../README.md#modulation) of the README.
