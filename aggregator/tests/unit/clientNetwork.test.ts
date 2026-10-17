import { describe, expect, it } from "vitest";
import { isPrivateIp } from "../../src/http/clientNetwork.js";

describe("isPrivateIp", () => {
  it.each([
    "10.0.0.5",
    "172.18.0.3",
    "192.168.1.10",
    "127.0.0.1",
    "::1",
    "::ffff:172.19.0.2",
    "fd00::1",
  ])("%s é rede interna", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["8.8.8.8", "172.32.0.1", "198.51.100.7", "::ffff:200.10.1.1", "2001:db8::1"])(
    "%s é internet",
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  );
});
