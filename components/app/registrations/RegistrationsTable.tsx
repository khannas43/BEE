"use client";

import Link from "next/link";
import { ListPager, ListToolbar, SortableTh, useListTools } from "@/components/app/kit/listTools";
import { REGISTRATION_FEE_STATE, REGISTRATION_KIND_LABEL, REGISTRATION_STATE_LABEL } from "@/components/app/registrations/labels";
import { type Registration, registrationRequestHref } from "@/lib/client/runtimeRegistrations";

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
  const th = "py-1 pr-3";
  return (
    <div className="space-y-space-sm">
      <ListToolbar tools={tools} searchLabel="Search by reference or brand" placeholder="Reference, brand or organisation" dateLabel="Valid from" />
      {tools.visible.length === 0 ? <p className="font-body-sm text-on-surface-variant">No requests match.</p> : (
        <>
          <table className="w-full font-body-sm text-body-sm" data-testid={review ? "rev-table" : "reg-list-table"}>
            <thead>
              <tr className="text-left text-on-surface-variant font-label-sm">
                <SortableTh tools={tools} k="ref" className={th}>Reference</SortableTh>
                <SortableTh tools={tools} k="kind" className={th}>Kind</SortableTh>
                <SortableTh tools={tools} k="brand" className={th}>Brand</SortableTh>
                {review ? <SortableTh tools={tools} k="who" className={th}>Applicant</SortableTh> : null}
                <SortableTh tools={tools} k="state" className={th}>State</SortableTh>
                {review ? null : <SortableTh tools={tools} k="fee" className={th}>Fee</SortableTh>}
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {tools.paged.pageRows.map((item) => (
                <tr key={item.id} data-testid={`${prefix}-row-${item.reference}`} data-state={item.state}>
                  <td className={th}>{item.reference}</td>
                  <td className={th}>{REGISTRATION_KIND_LABEL[item.kind]}</td>
                  <td className={th}>{item.brandName}</td>
                  {review ? <td className={th}>{item.organisation}</td> : null}
                  <td className={th}>{REGISTRATION_STATE_LABEL[item.state]}</td>
                  {review ? null : <td className={th}>{feeText(item)}</td>}
                  <td className="py-1">
                    <Link href={registrationRequestHref(item.id)} className="text-primary" data-testid={`${prefix}-open-${item.reference}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ListPager tools={tools} />
        </>
      )}
    </div>
  );
}
