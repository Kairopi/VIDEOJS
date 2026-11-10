import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

// What the preview plays. Mux derives the poster and the storyboard (thumbnails track) from the playback ID;
// Tint reads that storyboard to build the fingerprint. Sprite Fright © Blender Foundation, CC BY 4.0.
const PLAYBACK_ID = 'VZtzUzGRv02OhRnZCxcNg49OilvolTqdnFLEqBsTwaxU';
const SRC = `https://stream.mux.com/${PLAYBACK_ID}.m3u8`;
const TITLE = 'Sprite Fright';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  player.setAttribute('content-title', TITLE);

  player.innerHTML = skinTemplate.replace(
    MEDIA_PLACEHOLDER,
    `<mux-video src="${SRC}" playsinline crossorigin="anonymous"></mux-video>`
  );

  return player;
}
