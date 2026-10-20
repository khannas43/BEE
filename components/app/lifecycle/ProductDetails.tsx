"use client";

import { useEffect, useState } from "react";
import { AC_TYPES, COMPRESSORS, eerOf, readTechnicalDetails, type TechnicalDetails } from "@/lib/client/runtimeModelTechnical";

const word = (list: [string, string][], v: string) => list.find(([k]) => k === v)?.[1] ?? v;
const Fact = ({ label, value }: { label: string; value: string }) => (
  <div><div className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">{label}</div><div className="mt-0.5 text-[14px] font-semibold text-[#14315E]">{value || "-"}</div></div>
);

/** The product details recorded with a model application (read only). Shows nothing when none were recorded or the read is refused. */
export function ProductDetails({ applicationId }: { applicationId: string }) {
  const [d, setD] = useState<TechnicalDetails | null>(null);
  useEffect(() => {
    let live = true;
    void readTechnicalDetails(applicationId).then((r) => { if (live && r.ok && r.saved) setD(r.details); });
    return () => { live = false; };
  }, [applicationId]);
  if (!d) return null;
  const eer = eerOf(d);
  return (
    <div className="mt-space-md rounded-xl border border-[#dbe6f7] bg-white p-4" data-testid="model-product-details">
      <div role="heading" aria-level={3} className="mb-3 text-[15px] font-bold text-[#14315E]">Product details</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Air conditioner type" value={word(AC_TYPES, d.acType)} /><Fact label="Compressor" value={word(COMPRESSORS, d.compressorType)} /><Fact label="Refrigerant" value={d.refrigerant} />
        <Fact label="Rated cooling capacity" value={d.coolingCapacityW ? `${Number(d.coolingCapacityW).toLocaleString("en-IN")} W` : ""} />
        <Fact label="Rated power input" value={d.powerInputW ? `${Number(d.powerInputW).toLocaleString("en-IN")} W` : ""} />
        <Fact label="Energy efficiency ratio" value={eer === null ? "" : String(eer)} />
        <Fact label="Rated voltage" value={d.ratedVoltage ? `${d.ratedVoltage} V` : ""} /><Fact label="Test report number" value={d.testReportNumber} />
      </div>
    </div>
  );
}
