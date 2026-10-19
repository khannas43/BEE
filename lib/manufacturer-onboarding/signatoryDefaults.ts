import type { AuthorisedSignatory } from "./types";

export function emptyAuthorisedSignatory(): AuthorisedSignatory {
  return {
    name: "",
    email: "",
    phone: "",
    role: "",
    pan: "",
    aadhaar: "",
    fatherName: "",
    din: "",
    residentialAddress: { line1: "", line2: "", city: "", state: "", pincode: "" },
  };
}
