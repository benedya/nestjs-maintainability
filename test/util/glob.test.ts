import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesGlob } from "../../src/util/glob.js";

describe("glob matching", () => {
  it("matches `*` within one path segment only", () => {
    expect(matchesGlob("*Repository", "UsersRepository")).toBe(true);
    expect(matchesGlob("*.entity.ts", "user.entity.ts")).toBe(true);
    expect(matchesGlob("*.entity.ts", "src/user.entity.ts")).toBe(false);
  });

  it("lets `**` span directories, including none at all", () => {
    expect(matchesGlob("**/*.repository.ts", "src/users/users.repository.ts")).toBe(true);
    expect(matchesGlob("**/*.repository.ts", "users.repository.ts")).toBe(true);
    expect(matchesGlob("**/entities/**", "src/orders/entities/order.entity.ts")).toBe(true);
    expect(matchesGlob("**/entities/**", "src/orders/order.entity.ts")).toBe(false);
  });

  it("is case-insensitive, so a local spelling habit cannot change a score", () => {
    expect(matchesGlob("*Repository", "usersrepository")).toBe(true);
  });

  it("treats regex metacharacters as literals", () => {
    expect(matchesGlob("a.b", "a.b")).toBe(true);
    expect(matchesGlob("a.b", "axb")).toBe(false);
  });

  it("matches nothing against an empty pattern list", () => {
    expect(matchesAnyGlob([], "anything")).toBe(false);
    expect(matchesAnyGlob(["*Entity", "*Repository"], "OrdersRepository")).toBe(true);
  });
});
