import base64
import io

import pytest
from PIL import Image, ImageDraw

from codec.board_ani import decode_board_ani, decode_gif_frames


def animation_fixture(disposal=2, count=4):
    palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255] + [0, 0, 0] * 252
    frames = []
    for i in range(count):
        image = Image.new("P", (108, 72), 0)
        image.putpalette(palette)
        x = 3 + i * 7
        ImageDraw.Draw(image).rectangle((x, 30, x + 4, 34), fill=1 + i % 3)
        frames.append(image)
    buffer = io.BytesIO()
    frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:],
                   duration=[(i + 1) * 100 for i in range(count)], loop=0,
                   transparency=0, disposal=disposal, optimize=False)
    return buffer.getvalue()


def png_frame(doc, index):
    return Image.open(io.BytesIO(base64.b64decode(doc["frames"][index]["png"].split(",")[1]))).convert("RGBA")


@pytest.mark.parametrize("disposal", [2, 3])
def test_gif_frames_preserve_composited_coordinates_and_transparency(disposal):
    doc = decode_gif_frames(animation_fixture([1, disposal, 2, 2]))
    assert doc["frameCount"] == 4
    assert (doc["width"], doc["height"]) == (108, 72)
    assert [f["duration"] for f in doc["frames"]] == [100, 200, 300, 400]
    assert doc["interval"] == 250
    first, second, third = [png_frame(doc, i) for i in range(3)]
    assert first.size == second.size == third.size == (108, 72)
    assert first.getpixel((4, 31)) == (255, 0, 0, 255)
    assert second.getpixel((4, 31)) == (255, 0, 0, 255)
    assert second.getpixel((11, 31)) == (0, 255, 0, 255)
    assert third.getpixel((11, 31))[3] == 0
    assert third.getpixel((18, 31)) == (0, 0, 255, 255)
    assert third.getpixel((4, 31))[3] == (255 if disposal == 3 else 0)
    assert third.getpixel((80, 50))[3] == 0


def test_gif_source_frame_limit_does_not_reduce_frames_to_one_board():
    data = animation_fixture(count=12)
    doc = decode_gif_frames(data)
    assert doc["frameCount"] == 12
    assert len(doc["frames"]) == 10
    assert png_frame(doc, 9).size == (108, 72)
    assert png_frame(doc, 9).getpixel((67, 31)) == (255, 0, 0, 255)
    # Existing clients still receive native-sized pages when not requesting sources.
    legacy = decode_board_ani(data)
    assert len(legacy["pages"]) == 10
    assert all(len(page) == 864 for page in legacy["pages"])


def test_gif_source_rejects_static_image():
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buffer, format="PNG")
    with pytest.raises(ValueError, match="GIF"):
        decode_gif_frames(buffer.getvalue())
