import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { accessSchema, issueAppCode, openSecret, redeemAppCode, safeNext, sealSecret, userForGoogleEmail } from "@/server/auth/google";
import { uniq } from "../helpers";

describe("Google sign-in", () => {
  it("stores the client secret encrypted and reads it back", () => {
    const sealed = sealSecret("GOCSPX-test-secret");
    expect(sealed).not.toContain("GOCSPX");
    expect(openSecret(sealed)).toBe("GOCSPX-test-secret");
    expect(openSecret(sealed.slice(0, -4) + "AAAA")).toBeNull();
  });

  it("validates the settings", () => {
    expect(accessSchema.safeParse({ publicUrl: "https://erp.example.in/", clientId: "1-abc.apps.googleusercontent.com" }).data?.publicUrl).toBe("https://erp.example.in");
    expect(accessSchema.safeParse({ publicUrl: "http://erp.example.in", clientId: "" }).success).toBe(false);
    expect(accessSchema.safeParse({ publicUrl: "", clientId: "not-a-client-id" }).success).toBe(false);
  });

  it("only returns to pages inside the app", () => {
    expect(safeNext("/invoices")).toBe("/invoices");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
  });

  it("lets in only active users whose email matches the Google account", async () => {
    const email = `${uniq("g").replace(/\W/g, "").toLowerCase()}@gmail.com`;
    const u = await prisma.user.create({ data: { username: email.split("@")[0], name: "Google User", email, passwordHash: "x" } });
    expect((await userForGoogleEmail(email.toUpperCase(), {})).id).toBe(u.id);
    await expect(userForGoogleEmail("stranger@gmail.com", {})).rejects.toThrow(/not registered/);
    await prisma.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    await expect(userForGoogleEmail(email, {})).rejects.toThrow(/disabled/);
  });

  it("app hand-over codes work once only", async () => {
    const code = await issueAppCode("user-1", 3);
    expect(await redeemAppCode(code)).toEqual({ uid: "user-1", sv: 3 });
    expect(await redeemAppCode(code)).toBeNull();
    expect(await redeemAppCode("garbage")).toBeNull();
  });
});
