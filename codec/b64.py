# GBox 64-alphabet used by 模板= coordinates / size / V1; papers.
#
# This exact order is initialized by rc3.exe at 0x4229c0:
#   0..9 -> 0..9, 10..35 -> A..Z, 36 -> _, 37 -> `, 38..63 -> a..z.
# Case order matters: for example ``wc`` is 3880, an original mapsize.tab size.
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_`abcdefghijklmnopqrstuvwxyz"
INDEX = {ch: i for i, ch in enumerate(ALPHABET)}

# Kind character in 模板= is mapdata.tab 序号, encoded 0-9 then A-Z (NOT the 64-alphabet).
KIND_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
KIND_INDEX = {ch: i for i, ch in enumerate(KIND_ALPHABET)}


class CodecError(ValueError):
    pass


def encode(n, width=0):
    if not isinstance(n, int) or n < 0:
        raise CodecError("need a non-negative int")
    if n == 0:
        s = ALPHABET[0]
    else:
        chars = []
        while n:
            n, r = divmod(n, 64)
            chars.append(ALPHABET[r])
        s = "".join(reversed(chars))
    if width:
        if len(s) > width:
            raise CodecError("value does not fit in %d chars" % width)
        s = s.rjust(width, ALPHABET[0])
    return s


def decode(s):
    if not s:
        raise CodecError("empty token")
    n = 0
    for ch in s:
        if ch not in INDEX:
            raise CodecError("invalid digit %r" % ch)
        n = n * 64 + INDEX[ch]
    return n


def encode_kind(n: int) -> str:
    if not isinstance(n, int) or n < 0 or n >= len(KIND_ALPHABET):
        raise CodecError("kind index out of range: %r" % n)
    return KIND_ALPHABET[n]


def decode_kind(ch: str) -> int:
    if not ch or ch[0] not in KIND_INDEX:
        raise CodecError("invalid kind character %r" % ch)
    return KIND_INDEX[ch[0]]
