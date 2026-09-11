"""Format check for the CKE1 sealed-file layout the toy will read.

The vector is shared with manager-api-node tests/unit/contentCrypto.test.js.
If these two disagree, the toy plays noise, so this file is the contract.

Run: python -m pytest test_client_crypto.py -q   (or: python test_client_crypto.py)
"""
import hmac
import hashlib
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from client_crypto import (
    HEADER_BYTES, WRAP_INFO, parse_header, seal, unseal,
    decrypt_stream, unwrap_pack_key, wrap_pack_key,
)

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
NONCE = bytes.fromhex("1011121314151617")
PLAIN = b"cheeko content encryption test!!"          # exactly 32 bytes
EXPECTED_HEX = "ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a"


def test_seal_layout():
    sealed = seal(PLAIN, K, 2, NONCE)
    assert len(sealed) == len(PLAIN) + HEADER_BYTES
    assert sealed[:4] == b"CKE1"
    assert sealed[4] == 2
    assert sealed[5:8] == b"\x00\x00\x00"
    assert sealed[8:16] == NONCE


def test_matches_the_shared_vector():
    sealed = seal(PLAIN, K, 2, NONCE)
    assert sealed[HEADER_BYTES:].hex() == EXPECTED_HEX


def test_parse_header_and_round_trip():
    sealed = seal(PLAIN, K)
    assert parse_header(sealed) == (2, sealed[8:16])
    assert unseal(sealed, K) == PLAIN


def test_plaintext_is_recognised_as_plaintext():
    assert parse_header(b"ID3\x04" + b"\x00" * 12) is None
    try:
        unseal(PLAIN, K)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "not sealed" in str(exc)


def test_nonce_differs_per_seal():
    assert seal(PLAIN, K)[8:16] != seal(PLAIN, K)[8:16]


def test_stream_decrypt_across_unaligned_chunks():
    big = os.urandom(5000)
    sealed = seal(big, K)
    body = sealed[HEADER_BYTES:]
    dec = decrypt_stream(K, sealed[8:16])
    out = dec.update(body[:2048]) + dec.update(body[2048:2055]) + dec.update(body[2055:])
    assert out == big


def test_unwrap_matches_the_server_derivation():
    secret = os.urandom(32)
    nonce_w = os.urandom(8)
    wrapped = wrap_pack_key(secret, K, nonce_w)
    assert unwrap_pack_key(secret, wrapped, nonce_w) == K
    # and independently, the way rfid.service.js computes it
    wrap_key = hmac.new(secret, WRAP_INFO, hashlib.sha256).digest()[:16]
    c = Cipher(algorithms.AES(wrap_key), modes.CTR(nonce_w + b"\x00" * 8)).decryptor()
    assert c.update(wrapped) + c.finalize() == K


def test_wrap_info_literal_is_pinned():
    # Deliberately hardcodes "cheeko-wrap-v1" instead of importing WRAP_INFO
    # from client_crypto, so this test catches the constant drifting inside
    # the module under test (an earlier review flagged the JS-side round-trip
    # test for importing the shared constant instead of pinning the literal).
    secret = os.urandom(32)
    nonce_w = os.urandom(8)
    wrapped = wrap_pack_key(secret, K, nonce_w)
    wrap_key = hmac.new(secret, b"cheeko-wrap-v1", hashlib.sha256).digest()[:16]
    c = Cipher(algorithms.AES(wrap_key), modes.CTR(nonce_w + b"\x00" * 8)).decryptor()
    assert c.update(wrapped) + c.finalize() == K


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
