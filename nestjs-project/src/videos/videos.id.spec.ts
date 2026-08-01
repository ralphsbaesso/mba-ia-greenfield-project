import { PUBLIC_ID_LENGTH, generatePublicId } from './videos.id';

describe('generatePublicId', () => {
  it('should produce ids of a fixed length', () => {
    const ids = Array.from({ length: 100 }, () => generatePublicId());

    for (const id of ids) {
      expect(id).toHaveLength(PUBLIC_ID_LENGTH);
    }
  });

  it('should produce ids restricted to the base64url alphabet', () => {
    const ids = Array.from({ length: 100 }, () => generatePublicId());

    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('should never emit base64 padding or non-url-safe characters', () => {
    const ids = Array.from({ length: 100 }, () => generatePublicId()).join('');

    expect(ids).not.toMatch(/[=+/]/);
  });

  it('should produce different ids on consecutive calls', () => {
    expect(generatePublicId()).not.toBe(generatePublicId());
  });

  it('should not collide across a bulk generation', () => {
    const total = 50_000;
    const ids = new Set<string>();

    for (let i = 0; i < total; i++) {
      ids.add(generatePublicId());
    }

    expect(ids.size).toBe(total);
  });
});
