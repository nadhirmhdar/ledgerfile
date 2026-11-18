import { describe, expect, it } from "vitest";
import { addressLines, checkLogo, cleanBrandingText, detectImage, fitLogo, hasBranding, letterheadLines, MAX_LOGO_BYTES, signatureFirmLines, type Branding } from "../src/domain/branding";
import { gifBytes, makeJpeg, makePng, svgBytes, webpBytes } from "./image-fixtures";

describe("telling an image apart by its first bytes", () => {
  it("reads a PNG's type and size from its header", () => {
    expect(detectImage(makePng(120, 40))).toEqual({ contentType: "image/png", width: 120, height: 40, interlaced: false });
    expect(detectImage(makePng(64, 48, { interlaced: true }))?.interlaced).toBe(true);
  });
  it("reads a JPEG's type and size from its frame header, past other segments", () => {
    expect(detectImage(makeJpeg(300, 90))).toEqual({ contentType: "image/jpeg", width: 300, height: 90, interlaced: false });
  });
  it("refuses everything else, whatever it is called", () => {
    for (const bytes of [svgBytes(), gifBytes(), webpBytes(), Buffer.from("%PDF-1.7 not an image"), Buffer.alloc(100), Buffer.from("MZ an executable")]) expect(detectImage(bytes)).toBeNull();
  });
  it("refuses truncated or damaged headers", () => {
    expect(detectImage(makePng().subarray(0, 20))).toBeNull();
    expect(detectImage(makeJpeg().subarray(0, 8))).toBeNull();
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    const notIhdr = Buffer.from(makePng());
    notIhdr[12] = 0x58;
    expect(detectImage(notIhdr)).toBeNull();
  });
});

describe("what may be kept as a logo", () => {
  it("accepts a PNG and a JPEG within the limits", () => {
    expect(checkLogo(makePng(64, 48))).toEqual({ ok: true, contentType: "image/png", width: 64, height: 48 });
    expect(checkLogo(makeJpeg(200, 100))).toEqual({ ok: true, contentType: "image/jpeg", width: 200, height: 100 });
    expect(checkLogo(makePng(32, 32)).ok).toBe(true);
    expect(checkLogo(makePng(2000, 2000)).ok).toBe(true);
  });
  it("refuses an SVG, a GIF, a WebP and anything else, even one that claims to be a PNG", () => {
    for (const bytes of [svgBytes(), gifBytes(), webpBytes(), Buffer.from("just text")]) {
      const r = checkLogo(bytes);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/PNG or JPEG/);
    }
  });
  it("refuses an empty file, and one over 1 MB", () => {
    expect(checkLogo(Buffer.alloc(0))).toEqual({ ok: false, message: "Choose an image file." });
    const big = Buffer.concat([makeJpeg(100, 100), Buffer.alloc(MAX_LOGO_BYTES)]);
    expect(checkLogo(big)).toEqual({ ok: false, message: expect.stringMatching(/larger than 1 MB/) });
    expect(checkLogo(Buffer.concat([makeJpeg(100, 100), Buffer.alloc(MAX_LOGO_BYTES - 200)])).ok).toBe(true);
  });
  it("refuses a picture that is too small or too large in pixels", () => {
    for (const [w, h] of [[31, 100], [100, 31], [10, 10]]) expect(checkLogo(makePng(w, h))).toEqual({ ok: false, message: expect.stringMatching(/too small.*32 pixels/) });
    for (const [w, h] of [[2001, 100], [100, 2001]]) expect(checkLogo(makeJpeg(w, h))).toEqual({ ok: false, message: expect.stringMatching(/too large.*2000/) });
  });
  it("refuses an interlaced PNG, with the way out", () => {
    expect(checkLogo(makePng(64, 48, { interlaced: true }))).toEqual({ ok: false, message: expect.stringMatching(/interlaced.*JPEG/) });
  });
});

describe("the firm's text", () => {
  const clean = (address: string, contactLine = "", registrationLine = "") => cleanBrandingText({ address, contactLine, registrationLine });
  it("is tidied: blank lines and stray spaces go, control characters are dropped, blank becomes none", () => {
    expect(clean("  Office 12 \r\n\r\n  Business Bay  \nDubai\u0000", " +971 4 000 0000 ", "  ")).toEqual({ ok: true, value: { address: "Office 12\nBusiness Bay\nDubai", contactLine: "+971 4 000 0000", registrationLine: null } });
    expect(clean("  \n ")).toEqual({ ok: true, value: { address: null, contactLine: null, registrationLine: null } });
  });
  it("has limits, said as sentences", () => {
    expect(clean("x".repeat(301))).toEqual({ ok: false, message: expect.stringMatching(/address is too long/) });
    expect(clean(Array.from({ length: 7 }, () => "line").join("\n"))).toEqual({ ok: false, message: expect.stringMatching(/too many lines/) });
    expect(clean("a", "c".repeat(201))).toEqual({ ok: false, message: expect.stringMatching(/contact line is too long/) });
    expect(clean("a", "", "r".repeat(201))).toEqual({ ok: false, message: expect.stringMatching(/registration line is too long/) });
    expect(clean("x".repeat(300)).ok).toBe(true);
  });
});

describe("what the outputs draw from it", () => {
  const none: Branding = { firmName: "Demo Audit Firm", address: null, contactLine: null, registrationLine: null, logo: null };
  const set: Branding = { ...none, address: "Office 12\nDubai", contactLine: "info@demo.test", registrationLine: "Licence 123" };
  it("treats a firm with nothing set as having no branding", () => {
    expect(hasBranding(none)).toBe(false);
    expect(hasBranding(null)).toBe(false);
    expect(hasBranding({ ...none, logo: { data: makePng(), contentType: "image/png", width: 64, height: 48 } })).toBe(true);
    expect(hasBranding({ ...none, registrationLine: "L" })).toBe(true);
    expect(letterheadLines(none)).toEqual([]);
    expect(signatureFirmLines(none)).toEqual([]);
  });
  it("puts the address, contact and registration lines on a letterhead, and the address and registration in a signature", () => {
    expect(addressLines(set)).toEqual(["Office 12", "Dubai"]);
    expect(letterheadLines(set)).toEqual(["Office 12", "Dubai", "info@demo.test", "Licence 123"]);
    expect(signatureFirmLines(set)).toEqual(["Office 12", "Dubai", "Licence 123"]);
  });
  it("keeps a logo's proportions inside a box", () => {
    expect(fitLogo({ width: 400, height: 100 }, 200, 50)).toEqual({ width: 200, height: 50 });
    expect(fitLogo({ width: 100, height: 100 }, 200, 50)).toEqual({ width: 50, height: 50 });
    expect(fitLogo({ width: 64, height: 32 }, 240, 64)).toEqual({ width: 128, height: 64 });
  });
});
