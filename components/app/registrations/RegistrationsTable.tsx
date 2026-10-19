"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { manufacturerProfileHref } from "@/lib/demo/manufacturerDirectory";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { REGISTRATION_FEE_STATE, REGISTRATION_KIND_LABEL, REGISTRATION_STATE_LABEL } from "@/components/app/registrations/labels";
import { type Registration, type RegistrationState, registrationRequestHref } from "@/lib/client/runtimeRegistrations";

const STATE_TONE: Record<RegistrationState, string> = {
  draft: "bg-[#eef2f7] text-[#475569] border-[#d8e0ea]",
  fee_due: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  programme_review: "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]",
  director_approval: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  approved: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]",
  returned: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  rejected: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
};

/** The registration lists (a person's own requests, and the review queue) with search, sort on every column and paging. */
export function RegistrationsTable({ items, variant }: { items: Registration[]; variant: "mine" | "review" }) {
  const review = variant === "review";
  const prefix = review ? "rev" : "reg";
  const feeText = (i: Registration) => `${REGISTRATION_FEE_STATE[i.state]}${i.submissionFee ? ` · INR ${i.submissionFee.totalInr} · ${i.submissionFee.label}` : ""}`;
  const tools = useListTools({
    rows: items,
    text: (i) => `${i.reference} ${REGISTRATION_KIND_LABEL[i.kind]} ${i.brandName} ${i.organisation} ${REGISTRATION_STATE_LABEL[i.state]}`,
    date: (i) => i.validFrom?.slice(0, 10),
    sortValue: (i, k) => (k === "ref" ? i.reference : k === "kind" ? REGISTRATION_KIND_LABEL[i.kind] : k === "brand" ? i.brandName : k === "who" ? i.organisation : k === "state" ? REGISTRATION_STATE_LABEL[i.state] : k === "from" ? i.validFrom ?? "" : feeText(i)),
  });
    const cell = "px-3 py-3 align-top";
    const head = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide";
    return (
      <div className="space-y-space-sm">
        <ListToolbar tools={tools} searchLabel="Search by reference or brand" placeholder="Reference, brand or organisation" dateLabel="Valid from" />
        {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No requests match.</p> : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={review ? "rev-table" : "reg-list-table"}>
                  <thead>
                    <tr>
                      <SortableTh tools={tools} k="ref" className={head}>Reference</SortableTh>
                      <SortableTh tools={tools} k="brand" className={head}>Brand</SortableTh>
                      {review ? <SortableTh tools={tools} k="who" className={head}>Applicant</SortableTh> : null}
                      <SortableTh tools={tools} k="state" className={head}>Stage</SortableTh>
                      <th className={head}>Fee</th>
                      <th className={head}>Valid from</th>
                      <th className={head}><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tools.paged.pageRows.map((item) => (
                      <tr key={item.id} data-testid={`${prefix}-row-${item.reference}`} data-state={item.state}>
                        <td className={cell}><span className="font-mono text-xs font-semibold">{item.reference}</span></td>
                        <td className={cell}>
                          <div className="font-semibold text-on-surface">{item.brandName}</div>
                          <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{item.companyId ? "Company" : REGISTRATION_KIND_LABEL[item.kind]} registration</span>
                        </td>
                        {review ? <td className={cell}>
                          <Link href={item.companyId ? `/app/demo/manufacturer-360?m=live-${encodeURIComponent(item.companyId)}` : manufacturerProfileHref(item.organisation)} className="font-semibold text-primary hover:underline" title="Open the Manufacturer 360 profile">{item.organisation}</Link>
                        </td> : null}
                        <td className={cell}>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[item.state]}`}>{item.companyId && item.state === "approved" ? "Registered, under observation" : REGISTRATION_STATE_LABEL[item.state]}</span>
                        </td>
                        <td className={cell}>
                          <div>{item.companyId ? "Verified automatically" : REGISTRATION_FEE_STATE[item.state]}</div>
                          {item.submissionFee ? <div className="text-xs text-on-surface-variant">INR {item.submissionFee.totalInr}{review ? "" : ` · ${item.submissionFee.label}`}</div> : item.companyId ? <div className="text-xs text-on-surface-variant">INR 5000.00</div> : null}
                        </td>
                        <td className={cell}>{item.validFrom ? item.validFrom.slice(0, 10) : "-"}</td>
                        <td className={`${cell} text-right`}>
                          <Link href={item.companyId ? "/app/manufacturer/director" : registrationRequestHref(item.id)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-primary bg-white px-3 py-1.5 font-semibold text-primary hover:bg-primary/5" data-testid={`${prefix}-open-${item.reference}`}>
                            {review ? "Open" : "View"} <Icon name="arrow_forward" size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <ListPager tools={tools} />
          </>
        )}
      </div>
    );
}
