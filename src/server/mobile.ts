import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

/** Addresses on the office network where phones can reach this server. */
export function lanAddresses(port: string) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => `http://${i!.address}:${port}`);
}

export function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0d1b2f", light: "#ffffff" } });
}
