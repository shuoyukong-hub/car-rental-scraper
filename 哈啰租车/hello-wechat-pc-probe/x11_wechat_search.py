import time

from Xlib import X, XK, display
from Xlib.ext import xtest


WECHAT_WINDOW_ID = 0x2000011
WINDOW_X = 226
WINDOW_Y = 527


def keycode(d, key):
    return d.keysym_to_keycode(XK.string_to_keysym(key))


def tap_key(d, key, delay=0.03):
    code = keycode(d, key)
    xtest.fake_input(d, X.KeyPress, code)
    d.sync()
    time.sleep(delay)
    xtest.fake_input(d, X.KeyRelease, code)
    d.sync()
    time.sleep(delay)


def click(d, x, y):
    xtest.fake_input(d, X.MotionNotify, x=x, y=y)
    d.sync()
    time.sleep(0.1)
    xtest.fake_input(d, X.ButtonPress, 1)
    d.sync()
    time.sleep(0.05)
    xtest.fake_input(d, X.ButtonRelease, 1)
    d.sync()
    time.sleep(0.2)


def type_ascii(d, text):
    for ch in text:
        if ch == " ":
            tap_key(d, "space")
        else:
            tap_key(d, ch)


def main():
    d = display.Display()
    root = d.screen().root
    win = d.create_resource_object("window", WECHAT_WINDOW_ID)
    try:
        win.configure(stack_mode=X.Above)
        win.set_input_focus(X.RevertToParent, X.CurrentTime)
        d.sync()
    except Exception:
        pass

    # PC WeChat search box is usually near the upper-left of the main window.
    click(d, WINDOW_X + 125, WINDOW_Y + 38)
    for _ in range(20):
        tap_key(d, "BackSpace")
    type_ascii(d, "haluozuche")
    tap_key(d, "Return")
    time.sleep(3)
    root.configure()
    d.sync()


if __name__ == "__main__":
    main()
