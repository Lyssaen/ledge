import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AVATAR_MAX_BYTES, prepareAvatar, resetAvatarForTests, setAvatar, squareCrop, useAvatar } from '../src/shell/avatar';
import { UserAvatar } from '../src/shell/UserAvatar';

beforeEach(() => { localStorage.clear(); resetAvatarForTests(); });

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'me', { type });

describe('the profile photo (desktop.avatar, #50)', () => {
  it('crops the centre square of the picture', () => {
    expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
    expect(squareCrop(300, 400)).toEqual({ sx: 0, sy: 50, size: 300 });
    expect(squareCrop(128, 128)).toEqual({ sx: 0, sy: 0, size: 128 });
  });

  it('refuses a file that is not an image, or too heavy, without reading it; an unreadable image is refused too', async () => {
    const shrink = vi.fn(() => Promise.resolve(PNG));
    expect(await prepareAvatar(file('text/plain'), shrink)).toEqual({ ok: false, reason: 'notImage' });
    expect(await prepareAvatar(file('image/png', AVATAR_MAX_BYTES + 1), shrink)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(shrink).not.toHaveBeenCalled();
    expect(await prepareAvatar(file('image/png'), () => Promise.reject(new Error('bad')))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await prepareAvatar(file('image/jpeg'), shrink)).toEqual({ ok: true, url: PNG });
  });

  it('is kept in desktop.avatar, followed live, and removed with null; a stored value that is not an image is ignored', () => {
    function Probe() { return <p>{useAvatar() ?? 'none'}</p>; }
    const { container } = render(<Probe />);
    expect(container).toHaveTextContent('none');
    act(() => setAvatar(PNG));
    expect(container).toHaveTextContent(PNG);
    expect(localStorage.getItem('desktop.avatar')).toBe(PNG);
    act(() => setAvatar(null));
    expect(container).toHaveTextContent('none');
    expect(localStorage.getItem('desktop.avatar')).toBeNull();
    localStorage.setItem('desktop.avatar', 'javascript:alert(1)');
    resetAvatarForTests();
    render(<Probe />);
    expect(container.ownerDocument.body).toHaveTextContent('none');
  });

  it('UserAvatar shows the photo, round and cropped, or the user icon without one; hidden from assistive technology', () => {
    const { container } = render(<UserAvatar size={15} />);
    const disc = container.querySelector('.av')!;
    expect(disc).toHaveAttribute('aria-hidden', 'true');
    expect(disc.querySelector('svg')).not.toBeNull();
    expect(disc.querySelector('img')).toBeNull();
    act(() => setAvatar(PNG));
    expect(disc.querySelector('img')).toHaveAttribute('src', PNG);
    expect(disc.querySelector('img')).toHaveAttribute('alt', '');
    expect(disc.querySelector('svg')).toBeNull();
  });
});
