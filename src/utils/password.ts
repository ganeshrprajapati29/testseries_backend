import argon2 from 'argon2';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP recommended minimum for argon2id)
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { ...OPTIONS, raw: false });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// A valid hash used to keep login timing similar when the account does not exist.
let dummyHash: string | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, plain);
}
