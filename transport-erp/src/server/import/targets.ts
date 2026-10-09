/**
 * What a client's file can be imported into, which ERP field each column can map to,
 * and the words people commonly use for those columns (for automatic mapping).
 */
import { SHEET_BY_KEY, type SheetKey, type Col } from "../backup/sheets.js";

export const IMPORT_TARGETS: { key: SheetKey; label: string }[] = [
  { key: "customers", label: "Customers" }, { key: "transporters", label: "Transporters" }, { key: "vehicles", label: "Vehicles" },
  { key: "drivers", label: "Drivers" }, { key: "loadingPoints", label: "Loading points" }, { key: "deliveryPoints", label: "Delivery points" },
  { key: "freight", label: "Freight rates" }, { key: "trips", label: "Trips" }, { key: "expenses", label: "Expenses" },
  { key: "receipts", label: "Customer receipts (payments received)" }, { key: "payments", label: "Transporter payments" },
];

/** How a reference column is matched when the file has a name instead of an ERP ID. */
export const REF_LOOKUP: Partial<Record<SheetKey, { label: string; nameField: string; keys: string[] }>> = {
  customers: { label: "Customer", nameField: "name", keys: ["name", "code", "company", "gstin", "mobile"] },
  transporters: { label: "Transporter", nameField: "name", keys: ["name", "code", "gstin", "mobile"] },
  vehicles: { label: "Vehicle", nameField: "vehicleNumber", keys: ["vehicleNumber", "code"] },
  drivers: { label: "Driver", nameField: "name", keys: ["name", "code", "mobile", "licenseNumber"] },
  loadingPoints: { label: "Loading point", nameField: "name", keys: ["name", "code", "city"] },
  deliveryPoints: { label: "Delivery point", nameField: "name", keys: ["name", "code", "city"] },
  trips: { label: "Trip", nameField: "tripNumber", keys: ["tripNumber", "lrNumber"] },
  invoices: { label: "Invoice", nameField: "invoiceNumber", keys: ["invoiceNumber"] },
  settlements: { label: "Settlement", nameField: "code", keys: ["code"] },
  documents: { label: "Document", nameField: "code", keys: ["code"] },
};

export type ImportField = { key: string; label: string; type: Col["type"]; required: boolean; ref?: SheetKey; options?: readonly string[] };

const SKIP = new Set(["id", "createdAt", "updatedAt", "createdBy", "status"]);

export function importFields(target: SheetKey): ImportField[] {
  const def = SHEET_BY_KEY[target];
  const out: ImportField[] = [];
  for (const c of def.columns) {
    if (c.derived || SKIP.has(c.key)) continue;
    if (c.ref) {
      const r = REF_LOOKUP[c.ref];
      out.push({ key: c.key, label: `${r?.label ?? c.header} (name or code)`, type: "string", required: !!c.required, ref: c.ref });
      continue;
    }
    // the record code is created automatically when not given
    const auto = ["code", "tripNumber"].includes(c.key);
    out.push({ key: c.key, label: c.header, type: c.type, required: !!c.required && !auto && !c.enum, options: c.enum });
  }
  const status = def.columns.find((c) => c.key === "status");
  if (status) out.push({ key: "status", label: "Status", type: "string", required: false, options: status.enum });
  return out;
}

/** Common column titles seen in transport businesses' own sheets (Indian usage). Normalised: lower case, letters and digits only. */
const SYN: Record<string, string[]> = {
  name: ["name", "partyname", "party", "customername", "customer", "clientname", "client", "consignor", "consignorname", "transportername", "transporter", "drivername", "driver", "suppliername", "vendorname", "vendor", "lorryowner", "brokername", "companyname", "pointname", "location", "place"],
  company: ["company", "firm", "firmname", "business", "organisation", "organization"],
  contactPerson: ["contactperson", "contact", "contactname", "person", "attn"],
  mobile: ["mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber", "contactno", "contactnumber", "cell", "whatsapp", "mob", "ph"],
  email: ["email", "emailid", "mail", "emailaddress"],
  gstin: ["gstin", "gst", "gstno", "gstnumber", "gstinno", "gstinuin"],
  pan: ["pan", "panno", "pannumber", "pancard"],
  address: ["address", "addr", "fulladdress", "billingaddress", "officeaddress"],
  city: ["city", "town", "district"],
  state: ["state", "statename"],
  pincode: ["pincode", "pin", "zip", "postalcode"],
  creditDays: ["creditdays", "credit", "creditperiod", "paymentdays", "days"],
  openingBalance: ["openingbalance", "opening", "openingbal", "obal", "balance", "outstanding", "dues"],
  paymentTerms: ["paymentterms", "terms"],
  bankName: ["bankname", "bank"], bankAccount: ["bankaccount", "accountno", "accountnumber", "acno", "acnumber", "account"],
  bankIfsc: ["ifsc", "ifsccode", "bankifsc"], bankBranch: ["branch", "bankbranch"], upiId: ["upi", "upiid", "gpay", "phonepe"],
  vehicleNumber: ["vehiclenumber", "vehicleno", "vehicle", "lorryno", "lorrynumber", "lorry", "truckno", "trucknumber", "truck", "regno", "registrationno", "registrationnumber", "vehno", "vno"],
  vehicleType: ["vehicletype", "type", "trucktype", "lorrytype", "body", "bodytype", "make", "model"],
  capacityTons: ["capacity", "capacitytons", "tonnage", "tons", "load", "loadcapacity"],
  ownerName: ["owner", "ownername", "vehicleowner"],
  rcExpiry: ["rc", "rcexpiry", "rcvalidity", "rcvalid", "rcdate"], insuranceExpiry: ["insurance", "insuranceexpiry", "insurancevalidity", "insurancedue", "insexpiry", "insurancedate"],
  fcExpiry: ["fc", "fcexpiry", "fitness", "fitnessexpiry", "fcvalidity", "fcdue"], permitExpiry: ["permit", "permitexpiry", "permitvalidity", "nationalpermit", "permitdue"],
  pollutionExpiry: ["pollution", "puc", "pucexpiry", "pollutionexpiry", "emission"], roadTaxExpiry: ["roadtax", "tax", "taxexpiry", "roadtaxexpiry", "taxvalidity", "taxdue"],
  licenseNumber: ["licensenumber", "licenseno", "licence", "licenceno", "dlno", "dl", "drivinglicense", "drivinglicence", "license"],
  licenseExpiry: ["licenseexpiry", "licenceexpiry", "dlexpiry", "dlvalidity", "licensevalidity", "licencevalidity"],
  rate: ["rate", "salary", "wage", "pay", "driverrate"],
  tripNumber: ["tripnumber", "tripno", "trip", "tripid", "bookingno", "bookingnumber"],
  tripDate: ["tripdate", "date", "loadingdate", "dispatchdate", "bookingdate", "dt", "lrdate"],
  customerId: ["customer", "customername", "party", "partyname", "client", "consignor", "billingparty", "billto"],
  transporterId: ["transporter", "transportername", "broker", "lorryowner", "owner", "fleetowner", "vendor", "supplier"],
  vehicleId: ["vehicle", "vehicleno", "vehiclenumber", "lorryno", "lorry", "truck", "truckno", "vehno", "vno"],
  driverId: ["driver", "drivername"],
  loadingPointId: ["loadingpoint", "from", "origin", "source", "loadingplace", "loadingat", "fromplace", "fromcity", "loading"],
  deliveryPointId: ["deliverypoint", "to", "destination", "dest", "unloadingplace", "deliveryplace", "toplace", "tocity", "delivery", "unloadingpoint"],
  material: ["material", "goods", "commodity", "item", "product", "description", "cargo"],
  quantity: ["quantity", "qty", "nos", "bags", "packages", "pkgs"], unit: ["unit", "uom", "units"],
  weightTons: ["weight", "weighttons", "wt", "tonnage", "tons", "mt", "netweight", "loadweight", "wtmt", "weightmt", "wttons", "wtton", "weightton", "weightintons", "netwt", "loadwt"],
  distanceKm: ["distance", "km", "kms", "distancekm", "kilometers", "kilometres"],
  lrNumber: ["lr", "lrno", "lrnumber", "gcno", "gcnumber", "consignmentno", "cnno", "bilty", "biltyno", "builtyno", "grno"],
  lrDate: ["lrdate", "gcdate", "biltydate"],
  ewayBillNumber: ["ewaybill", "ewaybillno", "ewaybillnumber", "ewb", "ewbno", "eway"], ewayBillExpiry: ["ewaybillexpiry", "ewbvalidity", "ewayvalidity", "ewbexpiry"],
  customerFreight: ["freight", "customerfreight", "freightamount", "billamount", "amount", "revenue", "partyfreight", "partyrate", "billingamount", "totalfreight", "freightcharges", "partyamount"],
  transporterHire: ["hire", "hireamount", "transporterhire", "lorryhire", "truckhire", "lorryfreight", "ownerfreight", "brokerfreight", "vehiclehire", "hirecharges", "lorryrent"],
  loadingCharges: ["loading", "loadingcharges", "loadingcharge", "hamali", "loadinghamali"], unloadingCharges: ["unloading", "unloadingcharges", "unloadingcharge", "unloadinghamali"],
  diesel: ["diesel", "fuel", "hsd", "dieselamount"], toll: ["toll", "tollcharges", "fastag", "tollgate"], rto: ["rto", "rtocharges", "police", "checkpost", "mamool"],
  driverBata: ["bata", "driverbata", "batta", "driverbatta", "driverallowance", "allowance"], otherExpense: ["other", "otherexpense", "others", "otherexpenses", "misc", "miscellaneous", "extra"],
  advance: ["advance", "advancepaid", "lorryadvance", "hireadvance", "adv"],
  remarks: ["remarks", "remark", "notes", "note", "comments"], notes: ["notes", "note", "remarks", "remark", "comments"],
  deliveredDate: ["delivereddate", "deliverydate", "unloadingdate", "reacheddate"], podReceivedDate: ["podreceiveddate", "poddate", "podreceived"],
  expenseDate: ["date", "expensedate", "billdate", "paiddate", "dt"], category: ["category", "type", "expensetype", "head", "expensehead", "account", "ledger"],
  amount: ["amount", "amt", "value", "total", "paid", "paidamount", "rs", "inr", "received", "receivedamount"],
  payee: ["paidto", "payee", "party", "vendor", "name"], paymentMode: ["paymentmode", "mode", "paymode", "paidby", "method"],
  paymentStatus: ["paymentstatus", "paid", "paidunpaid"], reference: ["reference", "ref", "refno", "billno", "voucherno", "utr", "chequeno", "txnid", "transactionid"],
  description: ["description", "details", "narration", "particulars", "remarks"],
  receiptDate: ["date", "receiptdate", "receiveddate", "paymentdate", "dt"], paymentDate: ["date", "paymentdate", "paiddate", "dt"],
  invoiceId: ["invoice", "invoiceno", "invoicenumber", "billno", "billnumber"], tdsAmount: ["tds", "tdsamount", "tdsdeducted"], mode: ["mode", "paymentmode", "paidby", "method"],
  settlementId: ["settlement", "settlementno"],
  rateType: ["ratetype", "per", "basis"], customerRate: ["customerrate", "partyrate", "rate", "freight", "freightrate"], transporterRate: ["transporterrate", "hirerate", "lorryrate", "hire"],
  effectiveFrom: ["effectivefrom", "from", "validfrom", "startdate"], effectiveTo: ["effectiveto", "to", "validto", "enddate", "validtill"],
  status: ["status", "tripstatus", "state", "active"],
  ownership: ["ownership", "own", "ownmarket"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best guess for each column of the client's file. Each ERP field is used at most once. */
export function suggestMapping(target: SheetKey, headers: string[]): Record<number, string> {
  const fields = importFields(target);
  const scores: { col: number; field: string; score: number }[] = [];
  headers.forEach((h, col) => {
    const n = norm(h);
    if (!n) return;
    for (const f of fields) {
      const words = [norm(f.key), norm(f.label.replace(/\(.*\)/, "")), ...(SYN[f.key] ?? [])];
      // in masters, a bare "Name" column is the record's own name, never a reference
      let score = 0;
      if (words.includes(n)) score = 100 - words.indexOf(n) * 0.1;
      else if (words.some((w) => w.length >= 4 && (n.startsWith(w) || n.endsWith(w)))) score = 60;
      else if (words.some((w) => w.length >= 5 && n.includes(w))) score = 40;
      if (score && f.required) score += 1;
      if (score) scores.push({ col, field: f.key, score });
    }
  });
  scores.sort((a, b) => b.score - a.score);
  const out: Record<number, string> = {};
  const used = new Set<string>();
  for (const s of scores) {
    if (out[s.col] !== undefined || used.has(s.field)) continue;
    out[s.col] = s.field;
    used.add(s.field);
  }
  return out;
}

// ---------------------------------------------------------------- value clean-up
const TRIP_STATUS: Record<string, string> = {
  booked: "BOOKED", booking: "BOOKED", pending: "BOOKED", open: "BOOKED", new: "BOOKED", allocated: "ALLOCATED", assigned: "ALLOCATED", placed: "ALLOCATED",
  loaded: "LOADED", loading: "LOADED", intransit: "IN TRANSIT", transit: "IN TRANSIT", ontheway: "IN TRANSIT", dispatched: "IN TRANSIT", running: "IN TRANSIT", moving: "IN TRANSIT",
  delivered: "DELIVERED", unloaded: "DELIVERED", reached: "DELIVERED", pod: "POD RECEIVED", podreceived: "POD RECEIVED", billed: "BILLED", invoiced: "BILLED",
  settled: "SETTLED", paid: "SETTLED", closed: "CLOSED", completed: "CLOSED", done: "CLOSED", cancelled: "CANCELLED", canceled: "CANCELLED", cancel: "CANCELLED",
};
const CATEGORY: Record<string, string> = {
  diesel: "DIESEL", fuel: "DIESEL", hsd: "DIESEL", petrol: "DIESEL", toll: "TOLL", fastag: "TOLL", rto: "RTO", police: "RTO", checkpost: "RTO",
  bata: "DRIVER BATA", batta: "DRIVER BATA", driverbata: "DRIVER BATA", driverallowance: "DRIVER BATA", loading: "LOADING", hamali: "LOADING", unloading: "UNLOADING",
  repair: "REPAIR", repairs: "REPAIR", tyre: "REPAIR", tyres: "REPAIR", spares: "REPAIR", maintenance: "MAINTENANCE", service: "MAINTENANCE", servicing: "MAINTENANCE",
  office: "OFFICE", rent: "OFFICE", stationery: "OFFICE", electricity: "OFFICE", telephone: "OFFICE", internet: "OFFICE", salary: "SALARY", salaries: "SALARY", wages: "SALARY",
};
const MODE: Record<string, string> = {
  cash: "CASH", bank: "BANK", banktransfer: "BANK", transfer: "BANK", imps: "BANK", neft: "NEFT", rtgs: "RTGS", upi: "UPI", gpay: "UPI", googlepay: "UPI", phonepe: "UPI", paytm: "UPI",
  cheque: "CHEQUE", check: "CHEQUE", chq: "CHEQUE", dd: "CHEQUE", card: "CARD", fuelcard: "FUEL CARD", credit: "CREDIT",
};

export function cleanValue(target: SheetKey, field: ImportField, v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") v = v.trim();
  if (v === "" || (typeof v === "string" && /^(-|na|n\/a|nil|none|null)$/i.test(v))) return null;
  const n = typeof v === "string" ? norm(v) : "";
  if (field.key === "vehicleNumber" || (field.ref === "vehicles")) return String(v).toUpperCase().replace(/[\s.-]/g, "");
  if (field.key === "gstin" || field.key === "pan" || field.key === "bankIfsc") return String(v).toUpperCase().replace(/\s/g, "");
  if (field.key === "mobile") return String(v).replace(/[^\d+]/g, "").replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  if (field.key === "status" && target === "trips") return TRIP_STATUS[n] ?? String(v).toUpperCase();
  if (field.key === "status") return /^(inactive|no|n|0|false|blocked|closed|deactive)$/i.test(String(v)) ? "INACTIVE" : "ACTIVE";
  if (field.key === "category") return CATEGORY[n] ?? (["DIESEL", "TOLL", "RTO", "DRIVER BATA", "LOADING", "UNLOADING", "REPAIR", "MAINTENANCE", "OFFICE", "SALARY", "OTHER"].includes(String(v).toUpperCase()) ? String(v).toUpperCase() : "OTHER");
  if (field.key === "paymentMode" || field.key === "mode") return MODE[n] ?? String(v).toUpperCase();
  if (field.key === "paymentStatus") return /^(unpaid|due|pending|no|n|credit|outstanding)$/i.test(String(v)) ? "UNPAID" : "PAID";
  if (field.key === "ownership") return /own|self|company/i.test(String(v)) ? "OWN" : /attach/i.test(String(v)) ? "ATTACHED" : "MARKET";
  if (field.key === "rateType") return /ton|mt/i.test(String(v)) ? "PER_TON" : /km/i.test(String(v)) ? "PER_KM" : "PER_TRIP";
  if (field.key === "rateType" || field.options) return String(v).toUpperCase();
  return v;
}

/** Values used when the client's file has no such column. */
export const DEFAULTS: Partial<Record<SheetKey, Record<string, string>>> = {
  customers: { status: "ACTIVE" }, transporters: { status: "ACTIVE" }, vehicles: { status: "ACTIVE", ownership: "MARKET" }, drivers: { status: "ACTIVE", rateType: "PER_TRIP" },
  loadingPoints: { status: "ACTIVE" }, deliveryPoints: { status: "ACTIVE" }, freight: { status: "ACTIVE", rateType: "PER_TRIP" },
  trips: { status: "DELIVERED" }, expenses: { status: "ACTIVE", paymentMode: "CASH", paymentStatus: "PAID", category: "OTHER" },
  receipts: { status: "ACTIVE", mode: "BANK" }, payments: { status: "ACTIVE", mode: "BANK" },
};
