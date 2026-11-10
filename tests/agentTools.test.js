import { checkUrl, isPrivateAddress } from "../agentTools.js";

const resolvesTo = (address) => async () => [{ address }];

describe("what the agent may fetch", () => {
  test("refuses private, loopback and link-local addresses, including cloud metadata", () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.3.4", "192.168.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("140.82.112.3")).toBe(false);
  });

  test("refuses a public name that resolves to a private address", async () => {
    await expect(checkUrl("https://internal.example.com/", resolvesTo("10.1.2.3"))).resolves.toEqual({ ok: false, reason: "private address" });
  });

  test("refuses other schemes and credentials in the URL", async () => {
    await expect(checkUrl("file:///etc/passwd", resolvesTo("1.1.1.1"))).resolves.toMatchObject({ ok: false });
    await expect(checkUrl("https://user:pw@example.com/", resolvesTo("93.184.215.14"))).resolves.toMatchObject({ ok: false, reason: "no credentials in URLs" });
  });

  test("allows a public page", async () => {
    await expect(checkUrl("https://nvd.nist.gov/vuln/detail/CVE-2024-3094", resolvesTo("129.6.13.5"))).resolves.toMatchObject({ ok: true });
  });
});
