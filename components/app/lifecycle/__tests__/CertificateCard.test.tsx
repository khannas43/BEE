import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CertificateCard } from "@/components/app/lifecycle/CertificateCard";

const cert = {
  registrationId: "BEE/RAC/2026/10001", validFrom: "2026-10-06", validTo: "2029-10-05", status: "valid" as const, stars: 4, declaredIseer: "4.50", verifiedIseer: "4.62",
  schemeKey: "RAC-ISEER-DEMO-1", localDemoCertificate: true as const, issuedAt: "2026-10-06T10:00:00Z",
};

describe("CertificateCard", () => {
  afterEach(cleanup);

  it("shows the registration ID, the validity, the stars and that it is a local demonstration", () => {
    render(<CertificateCard certificate={cert} />);
    expect(screen.getByTestId("model-app-certificate-registration").textContent).toBe("BEE/RAC/2026/10001");
    expect(screen.getByTestId("model-app-certificate-validity").textContent).toBe("Valid · valid from 2026-10-06 to 2029-10-05");
    expect(screen.getByTestId("model-app-certificate-rating").textContent).toBe("★★★★☆ 4 stars · efficiency 4.62");
    expect(screen.getByTestId("model-app-certificate-demo").textContent).toContain("not issued by BEE");
    expect(screen.getByTestId("model-app-certificate").getAttribute("data-status")).toBe("valid");
  });

  it("says expired when the dates have passed and uses the singular for one star", () => {
    render(<CertificateCard certificate={{ ...cert, status: "expired", stars: 1 }} />);
    expect(screen.getByTestId("model-app-certificate-validity").textContent).toContain("Expired");
    expect(screen.getByTestId("model-app-certificate-rating").textContent).toBe("★☆☆☆☆ 1 star · efficiency 4.62");
  });
});
