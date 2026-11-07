// Oman e-invoice (Fawtara) file: UBL 2.1 in the PINT OM profile, as published so far.
// The specification is not final; the accredited service provider (ASP) validates and signs the file,
// adds the QR code and reports it to the Tax Authority. This builds the invoice data in that shape.

const SPEC = 'urn:peppol:pint:billing-1@om-1';
const PROFILE = 'urn:peppol:bis:billing';
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = (n) => `currencyID="OMR">${(Math.round(Number(n || 0) * 1000) / 1000).toFixed(3)}`;
const r3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;

// Date and time in Muscat (UTC+4)
function muscat(ts) {
  const d = new Date(new Date(ts).getTime() + 4 * 3600e3).toISOString();
  return { date: d.slice(0, 10), time: `${d.slice(11, 19)}+04:00` };
}

function party(tag, { name, vat, cr, address, phone, email }) {
  return `<cac:${tag}><cac:Party>
      ${vat ? `<cbc:EndpointID schemeID="0235">${x(vat)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${x(name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>${address ? `<cbc:StreetName>${x(address)}</cbc:StreetName>` : ''}<cac:Country><cbc:IdentificationCode>OM</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${x(vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${x(name)}</cbc:RegistrationName>${cr ? `<cbc:CompanyID>${x(cr)}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
      ${phone || email ? `<cac:Contact>${phone ? `<cbc:Telephone>${x(phone)}</cbc:Telephone>` : ''}${email ? `<cbc:ElectronicMail>${x(email)}</cbc:ElectronicMail>` : ''}</cac:Contact>` : ''}
    </cac:Party></cac:${tag}>`;
}

const taxCat = (rate) => `<cbc:ID>${Number(rate) > 0 ? 'S' : 'Z'}</cbc:ID><cbc:Percent>${Number(rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`;

export function invoiceXml({ kind = 'invoice', garage: g, branch, customer: c = {}, vehicle: v = {}, invoice: inv, lines = [], credit }) {
  const isCredit = kind === 'credit';
  const root = isCredit ? 'CreditNote' : 'Invoice';
  const rate = Number(inv.vat_rate);
  const when = muscat(isCredit ? credit.issued_at : inv.issued_at);
  const seller = party('AccountingSupplierParty', { name: g.name, vat: g.vat_number, cr: g.cr_number, address: branch?.address || g.address, phone: branch?.phone || g.phone, email: g.email });
  const buyer = party('AccountingCustomerParty', { name: c.name || 'عميل نقدي', vat: c.vat_number, phone: c.phone, email: c.email });

  // Lines: an invoice lists its work and parts; a credit note carries one line with its reason
  const docLines = isCredit
    ? [{ description: credit.reason, qty: 1, unit_price: credit.subtotal, type: 'labor', class_code: null }]
    : lines;
  const lineTag = isCredit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = isCredit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const lineXml = docLines.map((l, i) => {
    const net = r3(Number(l.qty) * Number(l.unit_price));
    const tax = r3(net * rate / 100);
    const unit = l.type === 'labor' ? 'HUR' : 'H87';
    const cls = l.class_code ? `<cac:CommodityClassification><cbc:ItemClassificationCode listID="${l.type === 'part' ? 'HS' : 'OMSRV'}">${x(l.class_code)}</cbc:ItemClassificationCode></cac:CommodityClassification>` : '';
    return `<cac:${lineTag}>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:${qtyTag} unitCode="${isCredit ? 'C62' : unit}">${Number(l.qty)}</cbc:${qtyTag}>
      <cbc:LineExtensionAmount ${amt(net)}</cbc:LineExtensionAmount>
      <cac:TaxTotal><cbc:TaxAmount ${amt(tax)}</cbc:TaxAmount></cac:TaxTotal>
      <cac:Item><cbc:Name>${x(l.description)}</cbc:Name>${cls}<cac:ClassifiedTaxCategory>${taxCat(rate)}</cac:ClassifiedTaxCategory></cac:Item>
      <cac:Price><cbc:PriceAmount ${amt(l.unit_price)}</cbc:PriceAmount></cac:Price>
      <cac:ItemPriceExtension><cbc:Amount ${amt(net + tax)}</cbc:Amount></cac:ItemPriceExtension>
    </cac:${lineTag}>`;
  }).join('');

  const lineTotal = r3(docLines.reduce((a, l) => a + Number(l.qty) * Number(l.unit_price), 0));
  const discount = isCredit ? 0 : Number(inv.discount || 0);
  const net = isCredit ? Number(credit.subtotal) : Number(inv.subtotal);
  const vat = isCredit ? Number(credit.vat) : Number(inv.vat);
  const total = isCredit ? Number(credit.total) : Number(inv.total);
  const paid = isCredit ? 0 : Math.min(Number(inv.paid || 0), total);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- EMD Garage: Fawtara draft (PINT OM). To be validated, signed and reported by the accredited service provider. -->
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${SPEC}</cbc:CustomizationID>
  <cbc:ProfileID>${PROFILE}</cbc:ProfileID>
  <cbc:ID>${isCredit ? `CN-${credit.credit_no}` : inv.invoice_no}</cbc:ID>
  <cbc:UUID>${isCredit ? credit.uuid : inv.uuid}</cbc:UUID>
  <cbc:IssueDate>${when.date}</cbc:IssueDate>
  <cbc:IssueTime>${when.time}</cbc:IssueTime>
  <cbc:${isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${isCredit ? 381 : 380}</cbc:${isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  ${v.plate_number || v.make ? `<cbc:Note>${x([v.make, v.model, v.year].filter(Boolean).join(' '))}${v.plate_number ? ` · ${x(v.plate_number)} ${x(v.plate_letters || '')}` : ''}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>OMR</cbc:DocumentCurrencyCode>
  ${isCredit ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv.invoice_no}</cbc:ID><cbc:UUID>${inv.uuid}</cbc:UUID><cbc:IssueDate>${muscat(inv.issued_at).date}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  ${seller}
  ${buyer}
  ${discount ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason><cbc:Amount ${amt(discount)}</cbc:Amount><cac:TaxCategory>${taxCat(rate)}</cac:TaxCategory></cac:AllowanceCharge>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(vat)}</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount ${amt(net)}</cbc:TaxableAmount><cbc:TaxAmount ${amt(vat)}</cbc:TaxAmount><cac:TaxCategory>${taxCat(rate)}</cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${amt(lineTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${amt(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${amt(total)}</cbc:TaxInclusiveAmount>
    ${discount ? `<cbc:AllowanceTotalAmount ${amt(discount)}</cbc:AllowanceTotalAmount>` : ''}
    ${paid ? `<cbc:PrepaidAmount ${amt(paid)}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount ${amt(total - paid)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineXml}
</${root}>
`;
}

// What is missing before the garage's invoices can go through Fawtara
export function readiness(garage, items, services) {
  const goods = items.filter((i) => i.active !== false), svc = services.filter((s) => s.active !== false);
  return [
    { ok: !!garage.vat_number, label: 'الرقم الضريبي للكراج', fix: 'أضفه في بيانات الكراج أعلاه' },
    { ok: !!garage.cr_number, label: 'رقم السجل التجاري', fix: 'أضفه في بيانات الكراج أعلاه' },
    { ok: !!garage.address, label: 'عنوان الكراج', fix: 'أضفه في بيانات الكراج أعلاه' },
    { ok: goods.length > 0 && goods.every((i) => i.hs_code), label: 'رمز التصنيف الجمركي (HS) لكل صنف', count: [goods.filter((i) => i.hs_code).length, goods.length], fix: 'أضفه من تعديل الصنف في المخزون' },
    { ok: svc.length > 0 && svc.every((s) => s.service_code), label: 'رمز نوع الخدمة لكل خدمة', count: [svc.filter((s) => s.service_code).length, svc.length], fix: 'أضفه من تعديل الخدمة أدناه' },
  ];
}
