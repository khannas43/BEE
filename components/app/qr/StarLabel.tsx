import Image from "next/image";
import { QrCode } from "@/components/app/lifecycle/QrCode";

export type LabelFacts = { brand: string; model: string; certificate: string; stars: number; iseer: string; validTo: string; category: string };

/** A BEE star label as it would sit on the product: the rating, the efficiency figure, the model and a QR code that opens the label check. */
export function StarLabel({ facts, serial, url, qrSize = 150, compact = false }: { facts: LabelFacts; serial: string; url: string; qrSize?: number; compact?: boolean }) {
  const n = Math.max(0, Math.min(5, facts.stars));
  return (
    <div className={`star-label ${compact ? "star-label-compact" : ""}`} data-testid="star-label">
      <div className="star-label-top">
        <Image src="/images/bee-logo.png" alt="Bureau of Energy Efficiency" width={1260} height={308} className="star-label-logo" />
      </div>
      <div className="star-label-title">STAR LABEL<span>Room air conditioner</span></div>
      <div className="star-label-rating" aria-label={`${n} star`}>
        <span className="star-label-stars">{"★".repeat(n)}<i>{"★".repeat(5 - n)}</i></span>
        <span className="star-label-n">{n} STAR</span>
      </div>
      <div className="star-label-iseer"><span>Energy efficiency (ISEER)</span><b>{facts.iseer || "-"}</b></div>
      <div className="star-label-model"><b>{facts.brand}</b> {facts.model}</div>
      <div className="star-label-qr">
        <QrCode text={url} size={qrSize} title={`QR code for ${serial}`} testId="qr-label-code" />
        <div className="star-label-scan">Scan to check this label</div>
      </div>
      <div className="star-label-serial">{serial}</div>
      <div className="star-label-foot">Certificate {facts.certificate} · valid to {facts.validTo}</div>
      <div className="star-label-demo">Local demonstration, not a BEE label</div>
    </div>
  );
}
