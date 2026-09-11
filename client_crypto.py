"""CKE1 sealed-content crypto for the device mimic.

Mirrors manager-api-node/src/utils/contentCrypto.js and what the firmware will
do with mbedtls_aes_crypt_ctr. Kept in its own module, with no client.py
imports, so the format can be tested without MQTT, audio or a server.

Format (docs/sd-content-encryption.md section 3):
    "CKE1" | version(1) | zero(3) | nonce(8) | AES-128-CTR body
Counter block is nonce || 64-bit big-endian counter from 0, which is exactly
what CTR mode with iv = nonce + 8 zero bytes produces.
"""
import hashlib
import hmac
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"CKE1"
HEADER_BYTES = 16
WRAP_INFO = b"cheeko-wrap-v1"


def _ctr(key: bytes, nonce: bytes):
    return Cipher(algorithms.AES(key), modes.CTR(nonce + b"\x00" * 8),
                  backend=default_backend())


def parse_header(head: bytes):
    """(version, nonce) for a sealed file, or None when this is plaintext."""
    if not head or len(head) < HEADER_BYTES or head[:4] != MAGIC:
        return None
    return head[4], bytes(head[8:16])


def seal(plain: bytes, key: bytes, version: int = 2, nonce: bytes = None) -> bytes:
    nonce = nonce or os.urandom(8)
    header = MAGIC + bytes([version]) + b"\x00\x00\x00" + nonce
    enc = _ctr(key, nonce).encryptor()
    return header + enc.update(plain) + enc.finalize()


def unseal(sealed: bytes, key: bytes) -> bytes:
    parsed = parse_header(sealed)
    if parsed is None:
        raise ValueError("not sealed")
    dec = _ctr(key, parsed[1]).decryptor()
    return dec.update(sealed[HEADER_BYTES:]) + dec.finalize()


def decrypt_stream(key: bytes, nonce: bytes):
    """Sequential decryptor for chunked reads.

    The toy reads 2 KB at a time. 2048 is a whole number of AES blocks, but a
    reader must not rely on that: the keystream position has to survive
    between calls whatever the chunk size. cryptography's CipherContext
    already does that; this wrapper just names the intent.
    """
    return _ctr(key, nonce).decryptor()


def _wrap_key(secret: bytes) -> bytes:
    return hmac.new(secret, WRAP_INFO, hashlib.sha256).digest()[:16]


def unwrap_pack_key(secret: bytes, wrapped: bytes, nonce_w: bytes) -> bytes:
    dec = _ctr(_wrap_key(secret), nonce_w).decryptor()
    return dec.update(wrapped) + dec.finalize()


def wrap_pack_key(secret: bytes, key: bytes, nonce_w: bytes) -> bytes:
    """CTR is symmetric, so this is unwrap under another name. Test-side only."""
    return unwrap_pack_key(secret, key, nonce_w)
