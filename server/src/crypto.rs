use rsa::{Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey};
use rsa::pkcs8::EncodePublicKey;
use aes::cipher::BlockEncryptMut;
use sha1::{Sha1, Digest};
use num_bigint::BigInt;

/// RSA 1024-bit key pair for Minecraft encryption handshake.
pub struct ServerKeyPair {
    private_key: RsaPrivateKey,
    pub public_key_der: Vec<u8>,
}

impl ServerKeyPair {
    /// Generate a new 1024-bit RSA key pair.
    pub fn generate() -> Self {
        let mut rng = rand::thread_rng();
        let private_key = RsaPrivateKey::new(&mut rng, 1024)
            .expect("failed to generate RSA key");
        let public_key = RsaPublicKey::from(&private_key);
        let public_key_der = public_key
            .to_public_key_der()
            .expect("failed to encode public key")
            .to_vec();
        ServerKeyPair {
            private_key,
            public_key_der,
        }
    }

    /// Decrypt ciphertext using PKCS1v15 padding.
    pub fn decrypt(&self, ciphertext: &[u8]) -> Vec<u8> {
        self.private_key
            .decrypt(Pkcs1v15Encrypt, ciphertext)
            .expect("RSA decryption failed")
    }
}

/// AES-128/CFB8 bidirectional stream cipher.
/// Key and IV are both the 16-byte shared secret.
/// The cipher is continuous (stateful) across packets.
///
/// CFB8's AsyncStreamCipher trait consumes self on encrypt/decrypt,
/// so we process byte-by-byte using the underlying block encrypt,
/// maintaining the 16-byte IV state manually — exactly how CFB-8 works.
pub struct CipherPair {
    encrypt_iv: [u8; 16],
    decrypt_iv: [u8; 16],
    key: [u8; 16],
}

impl CipherPair {
    /// Create a new cipher pair. Key = IV = shared_secret.
    pub fn new(shared_secret: &[u8; 16]) -> Self {
        CipherPair {
            encrypt_iv: *shared_secret,
            decrypt_iv: *shared_secret,
            key: *shared_secret,
        }
    }

    /// Encrypt data in-place (continuous CFB-8 stream).
    pub fn encrypt(&mut self, data: &mut [u8]) {
        use aes::cipher::KeyInit;
        let mut cipher = aes::Aes128::new((&self.key).into());
        for byte in data.iter_mut() {
            // Encrypt the IV block to get keystream
            let mut block = self.encrypt_iv.into();
            cipher.encrypt_block_mut(&mut block);
            // XOR first byte of encrypted block with plaintext byte
            let keystream_byte = block[0];
            *byte ^= keystream_byte;
            // Shift IV left by 1 byte, append ciphertext byte
            self.encrypt_iv.copy_within(1.., 0);
            self.encrypt_iv[15] = *byte; // ciphertext byte
        }
    }

    /// Decrypt data in-place (continuous CFB-8 stream).
    pub fn decrypt(&mut self, data: &mut [u8]) {
        use aes::cipher::KeyInit;
        let mut cipher = aes::Aes128::new((&self.key).into());
        for byte in data.iter_mut() {
            // Encrypt the IV block to get keystream
            let mut block = self.decrypt_iv.into();
            cipher.encrypt_block_mut(&mut block);
            let keystream_byte = block[0];
            let ciphertext_byte = *byte;
            *byte ^= keystream_byte; // decrypt: ciphertext XOR keystream = plaintext
            // Shift IV left by 1 byte, append ciphertext byte (pre-decryption)
            self.decrypt_iv.copy_within(1.., 0);
            self.decrypt_iv[15] = ciphertext_byte;
        }
    }
}

/// Compute the Minecraft-style hex digest for server authentication.
///
/// SHA-1 hash of (server_id + shared_secret + public_key_der),
/// interpreted as a signed big-endian integer, formatted as hex
/// with a `-` prefix if negative.
pub fn minecraft_hex_digest(server_id: &str, shared_secret: &[u8], public_key_der: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(server_id.as_bytes());
    hasher.update(shared_secret);
    hasher.update(public_key_der);
    let hash = hasher.finalize();

    let bigint = BigInt::from_signed_bytes_be(&hash);
    format!("{:x}", bigint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_digest_notch() {
        // Known test vector: "Notch" → positive hash
        let digest = minecraft_hex_digest("Notch", &[], &[]);
        assert_eq!(digest, "4ed1f46bbe04bc756bcb17c0c7ce3e4632f06a48");
    }

    #[test]
    fn test_hex_digest_jeb() {
        // Known test vector: "jeb_" → negative hash (has `-` prefix)
        let digest = minecraft_hex_digest("jeb_", &[], &[]);
        assert_eq!(digest, "-7c9d5b0044c130109a5d7b5fb5c317c02b4e28c1");
    }

    #[test]
    fn test_rsa_roundtrip() {
        let kp = ServerKeyPair::generate();
        let public_key = RsaPublicKey::from(&kp.private_key);
        let mut rng = rand::thread_rng();
        let plaintext = b"hello world 1234"; // 16 bytes
        let ciphertext = public_key
            .encrypt(&mut rng, Pkcs1v15Encrypt, plaintext)
            .unwrap();
        let decrypted = kp.decrypt(&ciphertext);
        assert_eq!(&decrypted, plaintext);
    }

    #[test]
    fn test_aes_cfb8_roundtrip() {
        let secret: [u8; 16] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let original = b"Hello, Minecraft!".to_vec();

        let mut enc_cipher = CipherPair::new(&secret);
        let mut dec_cipher = CipherPair::new(&secret);

        let mut data = original.clone();
        enc_cipher.encrypt(&mut data);
        assert_ne!(&data, &original); // encrypted differs
        dec_cipher.decrypt(&mut data);
        assert_eq!(&data, &original); // roundtrip matches
    }

    #[test]
    fn test_aes_cfb8_continuous() {
        // Verify cipher state carries across multiple encrypt/decrypt calls
        let secret: [u8; 16] = [0xAB; 16];
        let mut enc = CipherPair::new(&secret);
        let mut dec = CipherPair::new(&secret);

        let part1 = b"first chunk ".to_vec();
        let part2 = b"second chunk".to_vec();

        let mut e1 = part1.clone();
        let mut e2 = part2.clone();
        enc.encrypt(&mut e1);
        enc.encrypt(&mut e2);

        dec.decrypt(&mut e1);
        dec.decrypt(&mut e2);
        assert_eq!(&e1, &part1);
        assert_eq!(&e2, &part2);
    }
}
