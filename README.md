# Tint

A Video.js v10 skin that wears the film's colours.

Every film has a colour fingerprint: squeeze each moment into one stripe and line them up. Tint makes that fingerprint the poster and the timeline, and lets the scene you're watching colour the controls.

## What it does

- **Poster:** the film's fingerprint fills the frame, with the title, length and number of scenes.
- **Play:** the fingerprint pours into the timeline. At the end it rises back into the poster.
- **Timeline:** watched colour is lit, unwatched is dimmed. Small gaps mark scene changes. The preview frame is edged in the colour of the moment under the pointer.
- **Scenes:** found from colour changes, or taken from the video's chapters when it has them. Open the Scenes menu, or press `[` and `]`.
- **Accent:** play button, focus ring, volume and menus follow the current scene, set to a lightness that stays readable on the dark controls.
- **Error:** the colour drains to grey.

## How it works

Tint reads the player's thumbnails track: the same storyboard Video.js uses for timeline previews (Mux adds it automatically). It decodes the storyboard image once, then:

1. cuts every frame into thin vertical slits and squeezes each slit into one column, so the stripes keep the picture's structure;
2. picks each frame's strongest hue from a chroma-weighted hue histogram in OKLab;
3. marks a scene change wherever the mean colour jumps further than usual.

It never samples the playing video, so there's no per-frame cost and no cross-origin video taint. Without a thumbnails track the skin still works, with a neutral accent and a plain timeline.

Built from Video.js components (`media-time-slider`, `media-slider-thumbnail`, `media-menu`, hotkeys, gestures, error dialog, status announcer, indicators) plus five small elements of its own in [`src/video/tint`](src/video/tint), each reading state through `PlayerController`.

## Use it

Copy `src/` into your project, then:

```html
<video-player content-title="Sprite Fright">
  <!-- paste src/video/skin.html here, with your media in place of the comment -->
  <mux-video src="https://stream.mux.com/PLAYBACK_ID.m3u8" playsinline crossorigin="anonymous"></mux-video>
</video-player>
<script type="module">
  import '@videojs/html/video/player';
  import '@videojs/html/media/mux-video';
  import './src/video/skin.ts';
</script>
```

The media needs `crossorigin="anonymous"` so the storyboard can be read. Tint's type is Mona Sans when the page loads it, otherwise the system UI font.

## Keyboard

`Space`/`K` play · `←`/`→` 5 s · `J`/`L` 10 s · `↑`/`↓` volume · `M` mute · `F` fullscreen · `C` captions · `I` picture-in-picture · `0`–`9` jump to a percentage · `<`/`>` speed · `[`/`]` previous or next scene

## Accessibility

- One focus ring everywhere: an accent outline with a dark halo, visible over any frame.
- 44 px controls, larger in fullscreen; hover styles only on devices that hover.
- Reduced motion: the fold, colour easing and loading sweep turn off.
- Reduced transparency and more contrast: solid surfaces, white accent.
- Forced colours: system colours, plain timeline.
- State is never colour alone: icons, labels and the scene number change too.

## Customise

The public properties of the packaged skins work here too: `--media-accent-color` (pins the accent instead of following the scene), `--media-accent-text-color`, `--media-border-color`, `--media-border-radius`, `--media-font-family`, `--media-object-fit`, `--media-object-position`, `--media-scale-unit`.

## Develop

```sh
npm install
npm run dev      # workbench
npm run build    # static site in dist/
```

## Credits

Built on [Video.js v10](https://videojs.org) (Apache-2.0). Films by [Blender Studio](https://studio.blender.org), CC BY 4.0. See [NOTICE](NOTICE).

Licensed under the [Apache License 2.0](LICENSE).
