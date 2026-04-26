// KMS envelope encryption stub for cached responses.
//
// Production path:
//   1. GenerateDataKey (AES-256) against the service-specific CMK whose
//      key policy restricts `kms:Decrypt` to this workload's IAM role /
//      SPIFFE ID via an aws:PrincipalTag / sts:RoleSessionName mapping.
//   2. Encrypt the FHIR payload locally with the plaintext data key
//      (AES-256-GCM, 12-byte IV, no AAD reuse across messages).
//   3. Persist { ciphertext, iv, authTag, encryptedDataKey } together.
//   4. On read, KMS:Decrypt the data key, then AES-GCM-decrypt the body.
//   5. Zero the plaintext data key buffer after use.
//
// CloudTrail KMS events satisfy §164.312(b) - the audit log for every
// Decrypt carries the requesting principal and the encryption context.

export interface EnvelopeCiphertext {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  encryptedDataKey: Buffer;
  keyId: string;
}

export interface EnvelopeCrypto {
  encrypt(
    plaintext: Buffer,
    encryptionContext: Record<string, string>,
  ): Promise<EnvelopeCiphertext>;
  decrypt(
    payload: EnvelopeCiphertext,
    encryptionContext: Record<string, string>,
  ): Promise<Buffer>;
}

export class KmsEnvelopeCrypto implements EnvelopeCrypto {
  constructor(
    private readonly keyId: string,
    private readonly region: string,
  ) {}

  // TODO(prod): call KMS GenerateDataKey with the encryption context,
  // then AES-256-GCM with the plaintext key.
  async encrypt(
    _plaintext: Buffer,
    _encryptionContext: Record<string, string>,
  ): Promise<EnvelopeCiphertext> {
    throw new Error(
      `KMS envelope encrypt not implemented in prototype (keyId=${this.keyId}, region=${this.region})`,
    );
  }

  // TODO(prod): KMS Decrypt on the encrypted data key with the same
  // encryption context, then AES-256-GCM decrypt.
  async decrypt(
    _payload: EnvelopeCiphertext,
    _encryptionContext: Record<string, string>,
  ): Promise<Buffer> {
    throw new Error(
      `KMS envelope decrypt not implemented in prototype (keyId=${this.keyId}, region=${this.region})`,
    );
  }
}

// Deployment note: the ECS task / EKS pod must reach KMS via a VPC
// interface endpoint (com.amazonaws.<region>.kms) with an endpoint
// policy that restricts calls to this CMK. Outbound traffic to the
// public AWS KMS endpoint must be blocked by the egress security group.
