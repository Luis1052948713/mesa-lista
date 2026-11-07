// Facturación electrónica DIAN: CUFE, CUDE y XML UBL 2.1 según el Anexo Técnico 1.9 (Resolución 000165 de 2023).
// Es lógica pura: no firma ni envía. El XML sale con el espacio reservado para la firma digital.
//
// Los valores marcados "tabla" vienen de las tablas de la Caja de Herramientas de la DIAN (no están en el
// PDF del anexo) y hay que confirmarlos con el set de pruebas.
import { createHash } from 'node:crypto';

/** cbc:ProfileExecutionID: 1 producción, 2 pruebas (habilitación). */
export type Ambiente = 1 | 2;

const DIAN_AGENCY = 'schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"';
const NIT_DIAN = '800197268';

/** Tributos que entran en el CUFE. El orden y los códigos son fijos. */
export const TRIBUTOS = { iva: { id: '01', name: 'IVA' }, inc: { id: '04', name: 'INC' }, ica: { id: '03', name: 'ICA' } } as const;
export const SIN_TRIBUTO = { id: 'ZZ', name: 'No aplica' }; // tabla

export interface Direccion { municipioCodigo: string; municipio: string; departamentoCodigo: string; departamento: string; linea: string }

export interface Emisor {
  nit: string; dv: string; razonSocial: string; nombreComercial?: string;
  /** 1 persona jurídica, 2 persona natural (tabla). */
  tipoPersona: '1' | '2';
  /** TaxLevelCode del RUT; varias se separan con ";". Ej. "O-13;O-15". */
  obligaciones: string;
  tributo: { id: string; name: string };
  direccion: Direccion; correo?: string;
}

export interface Adquiriente {
  tipoPersona: '1' | '2';
  /** Código del tipo de documento: 31 NIT, 13 cédula (tabla). */
  tipoDocumento: string;
  numero: string; dv?: string; nombre: string; obligaciones: string;
  tributo: { id: string; name: string };
  direccion?: Direccion; correo?: string;
}

/** La DIAN identifica al consumidor final con este documento y el tipo de persona "2". */
export const CONSUMIDOR_FINAL: Adquiriente = {
  tipoPersona: '2', tipoDocumento: '13', numero: '222222222222', nombre: 'Consumidor final',
  obligaciones: 'R-99-PN', tributo: SIN_TRIBUTO,
};

export interface Software {
  /** Identificador que da la DIAN al registrar el software. */
  id: string;
  /** PIN que se escoge al registrarlo. Es secreto y no viaja en el XML. */
  pin: string;
  nitProveedor: string; dvProveedor: string;
}

export interface Numeracion {
  prefijo: string; autorizacion: string; inicio: string; fin: string; desde: number; hasta: number;
  /** Clave técnica del rango. Es secreta y no viaja en el XML. */
  claveTecnica: string;
}

export interface Linea {
  descripcion: string; cantidad: number;
  /** Precio unitario en pesos, antes de impuestos. */
  precio: number;
  /** Código interno del producto. */
  codigo?: string;
  /** Sin impuesto si es null. */
  impuesto: { tributo: { id: string; name: string }; tarifa: number } | null;
}

interface Comun {
  ambiente: Ambiente; emisor: Emisor; adquiriente: Adquiriente; software: Software;
  /** Consecutivo sin prefijo. */
  numero: number;
  /** AAAA-MM-DD en hora de Colombia. */
  fecha: string;
  /** HH:MM:SS-05:00 */
  hora: string;
  lineas: Linea[]; nota?: string;
  /** 1 contado, 2 crédito (tabla). */
  formaPago?: '1' | '2';
  /** 10 efectivo (tabla). */
  medioPago?: string;
  vencimiento?: string;
}

export interface Factura extends Comun {
  numeracion: Numeracion;
  /** Anticipo en pesos. Es informativo: el anexo 1.8+ no lo resta del valor a pagar. */
  anticipo?: number;
}

export interface Nota extends Comun {
  prefijo: string;
  factura: { numero: string; cufe: string; fecha: string };
  /** cbc:ResponseCode del concepto (tabla). */
  concepto: string;
  /** Mínimo 20 caracteres. */
  motivo: string;
}

/* ---------- dinero ---------- */

// Todo se calcula en centavos enteros para que las sumas cuadren exacto.
const toCents = (pesos: number) => Math.round(pesos * 100);
const money = (cents: number) => {
  const c = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
};

/** Valor con dos decimales truncados, sin separadores, como lo pide el anexo. */
export const valor = (pesos: number) => {
  const [ent, dec = ''] = pesos.toFixed(6).split('.');
  return `${ent}.${dec.slice(0, 2)}`;
};

export interface LineaCalculada extends Linea { base: number; tributo: number }
export interface Totales {
  lineas: LineaCalculada[]; bruto: number; baseImponible: number; total: number;
  /** Por tributo y tarifa; se reporta un TaxTotal por cada tributo. */
  impuestos: { tributo: { id: string; name: string }; tarifa: number; base: number; valor: number }[];
}

/** Totales en centavos, sumados desde las líneas. */
export function calcularTotales(lineas: Linea[]): Totales {
  const calc = lineas.map((l) => {
    const base = Math.round(l.cantidad * toCents(l.precio));
    return { ...l, base, tributo: l.impuesto ? Math.round((base * l.impuesto.tarifa) / 100) : 0 };
  });
  const grupos = new Map<string, Totales['impuestos'][number]>();
  for (const l of calc) {
    if (!l.impuesto) continue;
    const k = `${l.impuesto.tributo.id}|${l.impuesto.tarifa}`;
    const g = grupos.get(k) ?? { tributo: l.impuesto.tributo, tarifa: l.impuesto.tarifa, base: 0, valor: 0 };
    g.base += l.base;
    g.valor += l.tributo;
    grupos.set(k, g);
  }
  const impuestos = [...grupos.values()];
  const bruto = calc.reduce((a, l) => a + l.base, 0);
  return {
    lineas: calc, bruto, impuestos,
    baseImponible: impuestos.reduce((a, i) => a + i.base, 0),
    total: bruto + impuestos.reduce((a, i) => a + i.valor, 0),
  };
}

/* ---------- códigos ---------- */

export const sha384 = (s: string) => createHash('sha384').update(s, 'utf8').digest('hex');

export interface DatosCodigo {
  numero: string; fecha: string; hora: string;
  /** Valores ya formateados con dos decimales. */
  valFac: string; iva: string; inc: string; ica: string; total: string;
  nitEmisor: string; numAdq: string; ambiente: Ambiente;
}

const cadena = (d: DatosCodigo, secreto: string) =>
  d.numero + d.fecha + d.hora + d.valFac + '01' + d.iva + '04' + d.inc + '03' + d.ica + d.total + d.nitEmisor + d.numAdq + secreto + d.ambiente;

/** Código único de la factura (numeral 11.1.2): usa la clave técnica del rango. */
export const cufe = (d: DatosCodigo, claveTecnica: string) => sha384(cadena(d, claveTecnica));

/** Código único de notas crédito y débito (numeral 11.1.4): usa el PIN del software. */
export const cude = (d: DatosCodigo, pin: string) => sha384(cadena(d, pin));

/** Huella del software (numeral 11.1.8). */
export const codigoSeguridad = (softwareId: string, pin: string, numero: string) => sha384(softwareId + pin + numero);

/** URL del QR según el ambiente (numeral 11.1.7.1). */
export const urlQr = (codigo: string, ambiente: Ambiente) =>
  `https://catalogo-vpfe${ambiente === 2 ? '-hab' : ''}.dian.gov.co/document/searchqr?documentkey=${codigo}`;

/** Nombre del archivo: tipo + NIT a 10 dígitos + 000 (software propio) + año + consecutivo a 8 (numeral 6.7). */
export function nombreArchivo(tipo: 'fv' | 'nc' | 'nd' | 'z', nit: string, anio: number, consecutivo: number) {
  return `${tipo}${nit.padStart(10, '0')}000${String(anio % 100).padStart(2, '0')}${String(consecutivo).padStart(8, '0')}.${tipo === 'z' ? 'zip' : 'xml'}`;
}

/* ---------- validación ---------- */

function validar(d: Comun) {
  if (!d.lineas.length) throw new Error('El documento debe tener al menos un producto.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) throw new Error('La fecha debe ser AAAA-MM-DD.');
  if (!/^\d{2}:\d{2}:\d{2}-05:00$/.test(d.hora)) throw new Error('La hora debe ser HH:MM:SS-05:00 (hora de Colombia).');
  if (!/^\d+$/.test(d.emisor.nit)) throw new Error('El NIT del emisor va sin puntos, guiones ni dígito de verificación.');
  if (!/^\d+$/.test(d.adquiriente.numero) && d.adquiriente.tipoDocumento !== '41') {
    throw new Error('El documento del cliente va sin puntos ni guiones.');
  }
  if (d.adquiriente.tipoDocumento === '31' && !d.adquiriente.dv) throw new Error('Si el cliente tiene NIT, falta su dígito de verificación.');
  if (d.formaPago === '2' && !d.vencimiento) throw new Error('Una venta a crédito necesita fecha de vencimiento.');
  for (const l of d.lineas) {
    if (!(l.cantidad > 0)) throw new Error(`La cantidad de "${l.descripcion}" debe ser mayor que cero.`);
    if (l.precio < 0) throw new Error(`El precio de "${l.descripcion}" no puede ser negativo.`);
    if (!l.descripcion.trim()) throw new Error('Hay un producto sin descripción.');
  }
}

function validarFactura(f: Factura) {
  validar(f);
  const n = f.numeracion;
  if (f.numero < n.desde || f.numero > n.hasta) throw new Error(`El número ${f.numero} está fuera del rango autorizado (${n.desde} a ${n.hasta}).`);
  if (f.fecha < n.inicio || f.fecha > n.fin) throw new Error('La fecha de la factura está fuera de la vigencia de la numeración.');
  if (!/^[A-Za-z0-9]{0,4}$/.test(n.prefijo)) throw new Error('El prefijo debe tener hasta 4 letras o números.');
}

/* ---------- XML ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cop = 'currencyID="COP"';
const amount = (tag: string, cents: number) => `<cbc:${tag} ${cop}>${money(cents)}</cbc:${tag}>`;
const percent = (t: number) => t.toFixed(2);

function direccionXml(tag: string, d: Direccion) {
  return `<cac:${tag}><cbc:ID>${esc(d.municipioCodigo)}</cbc:ID><cbc:CityName>${esc(d.municipio)}</cbc:CityName>`
    + `<cbc:CountrySubentity>${esc(d.departamento)}</cbc:CountrySubentity><cbc:CountrySubentityCode>${esc(d.departamentoCodigo)}</cbc:CountrySubentityCode>`
    + `<cac:AddressLine><cbc:Line>${esc(d.linea)}</cbc:Line></cac:AddressLine>`
    + `<cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country></cac:${tag}>`;
}

const companyId = (numero: string, tipo: string, dv?: string) =>
  `<cbc:CompanyID ${DIAN_AGENCY}${dv ? ` schemeID="${esc(dv)}"` : ''} schemeName="${esc(tipo)}">${esc(numero)}</cbc:CompanyID>`;

const taxScheme = (t: { id: string; name: string }) => `<cac:TaxScheme><cbc:ID>${esc(t.id)}</cbc:ID><cbc:Name>${esc(t.name)}</cbc:Name></cac:TaxScheme>`;

function emisorXml(e: Emisor, prefijo: string) {
  const name = e.nombreComercial || e.razonSocial;
  const id = companyId(e.nit, '31', e.dv);
  return '<cac:AccountingSupplierParty>'
    + `<cbc:AdditionalAccountID>${e.tipoPersona}</cbc:AdditionalAccountID><cac:Party>`
    + `<cac:PartyName><cbc:Name>${esc(name)}</cbc:Name></cac:PartyName>`
    + `<cac:PhysicalLocation>${direccionXml('Address', e.direccion)}</cac:PhysicalLocation>`
    + `<cac:PartyTaxScheme><cbc:RegistrationName>${esc(e.razonSocial)}</cbc:RegistrationName>${id}`
    + `<cbc:TaxLevelCode>${esc(e.obligaciones)}</cbc:TaxLevelCode>${direccionXml('RegistrationAddress', e.direccion)}${taxScheme(e.tributo)}</cac:PartyTaxScheme>`
    + `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(e.razonSocial)}</cbc:RegistrationName>${id}`
    + `${prefijo ? `<cac:CorporateRegistrationScheme><cbc:ID>${esc(prefijo)}</cbc:ID></cac:CorporateRegistrationScheme>` : ''}</cac:PartyLegalEntity>`
    + `${e.correo ? `<cac:Contact><cbc:ElectronicMail>${esc(e.correo)}</cbc:ElectronicMail></cac:Contact>` : ''}`
    + '</cac:Party></cac:AccountingSupplierParty>';
}

function adquirienteXml(a: Adquiriente) {
  const id = companyId(a.numero, a.tipoDocumento, a.dv);
  return '<cac:AccountingCustomerParty>'
    + `<cbc:AdditionalAccountID>${a.tipoPersona}</cbc:AdditionalAccountID><cac:Party>`
    + `<cac:PartyIdentification><cbc:ID${a.dv ? ` schemeID="${esc(a.dv)}"` : ''} schemeName="${esc(a.tipoDocumento)}">${esc(a.numero)}</cbc:ID></cac:PartyIdentification>`
    + `<cac:PartyName><cbc:Name>${esc(a.nombre)}</cbc:Name></cac:PartyName>`
    + `${a.direccion ? `<cac:PhysicalLocation>${direccionXml('Address', a.direccion)}</cac:PhysicalLocation>` : ''}`
    + `<cac:PartyTaxScheme><cbc:RegistrationName>${esc(a.nombre)}</cbc:RegistrationName>${id}`
    + `<cbc:TaxLevelCode>${esc(a.obligaciones)}</cbc:TaxLevelCode>${taxScheme(a.tributo)}</cac:PartyTaxScheme>`
    + `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(a.nombre)}</cbc:RegistrationName>${id}</cac:PartyLegalEntity>`
    + `${a.correo ? `<cac:Contact><cbc:ElectronicMail>${esc(a.correo)}</cbc:ElectronicMail></cac:Contact>` : ''}`
    + '</cac:Party></cac:AccountingCustomerParty>';
}

const pagoXml = (d: Comun) => `<cac:PaymentMeans><cbc:ID>${d.formaPago ?? '1'}</cbc:ID><cbc:PaymentMeansCode>${esc(d.medioPago ?? '10')}</cbc:PaymentMeansCode>`
  + `${d.vencimiento ? `<cbc:PaymentDueDate>${esc(d.vencimiento)}</cbc:PaymentDueDate>` : ''}</cac:PaymentMeans>`;

const subtotalXml = (base: number, val: number, tarifa: number, t: { id: string; name: string }) =>
  `<cac:TaxSubtotal>${amount('TaxableAmount', base)}${amount('TaxAmount', val)}`
  + `<cac:TaxCategory><cbc:Percent>${percent(tarifa)}</cbc:Percent>${taxScheme(t)}</cac:TaxCategory></cac:TaxSubtotal>`;

/** Un TaxTotal por tributo, con un subtotal por cada tarifa. */
function impuestosXml(t: Totales) {
  const ids = [...new Set(t.impuestos.map((i) => i.tributo.id))];
  return ids.map((id) => {
    const grupo = t.impuestos.filter((i) => i.tributo.id === id);
    return `<cac:TaxTotal>${amount('TaxAmount', grupo.reduce((a, i) => a + i.valor, 0))}`
      + `${grupo.map((i) => subtotalXml(i.base, i.valor, i.tarifa, i.tributo)).join('')}</cac:TaxTotal>`;
  }).join('');
}

function totalXml(tag: string, t: Totales, anticipo = 0) {
  return `<cac:${tag}>${amount('LineExtensionAmount', t.bruto)}${amount('TaxExclusiveAmount', t.baseImponible)}${amount('TaxInclusiveAmount', t.total)}`
    + `${anticipo ? amount('PrepaidAmount', anticipo) : ''}${amount('PayableAmount', t.total)}</cac:${tag}>`;
}

function lineasXml(t: Totales, tag: string, qtyTag: string) {
  return t.lineas.map((l, i) => {
    const q = String(l.cantidad);
    const tax = l.impuesto
      ? `<cac:TaxTotal>${amount('TaxAmount', l.tributo)}${subtotalXml(l.base, l.tributo, l.impuesto.tarifa, l.impuesto.tributo)}</cac:TaxTotal>` : '';
    return `<cac:${tag}><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="94">${q}</cbc:${qtyTag}>${amount('LineExtensionAmount', l.base)}${tax}`
      + `<cac:Item><cbc:Description>${esc(l.descripcion)}</cbc:Description>`
      + `<cac:StandardItemIdentification><cbc:ID schemeID="999">${esc(l.codigo ?? String(i + 1))}</cbc:ID></cac:StandardItemIdentification></cac:Item>`
      + `<cac:Price>${amount('PriceAmount', toCents(l.precio))}<cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity></cac:Price></cac:${tag}>`;
  }).join('');
}

function extensiones(opts: { control?: Numeracion; software: Software; numero: string; codigo: string; ambiente: Ambiente }) {
  const { control: n, software: s } = opts;
  const control = n
    ? `<sts:InvoiceControl><sts:InvoiceAuthorization>${esc(n.autorizacion)}</sts:InvoiceAuthorization>`
      + `<sts:AuthorizationPeriod><cbc:StartDate>${esc(n.inicio)}</cbc:StartDate><cbc:EndDate>${esc(n.fin)}</cbc:EndDate></sts:AuthorizationPeriod>`
      + `<sts:AuthorizedInvoices>${n.prefijo ? `<sts:Prefix>${esc(n.prefijo)}</sts:Prefix>` : ''}<sts:From>${n.desde}</sts:From><sts:To>${n.hasta}</sts:To></sts:AuthorizedInvoices></sts:InvoiceControl>`
    : '';
  return '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><sts:DianExtensions>'
    + control
    + '<sts:InvoiceSource><cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" '
    + 'listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode></sts:InvoiceSource>'
    + `<sts:SoftwareProvider><sts:ProviderID ${DIAN_AGENCY} schemeID="${esc(s.dvProveedor)}" schemeName="31">${esc(s.nitProveedor)}</sts:ProviderID>`
    + `<sts:SoftwareID ${DIAN_AGENCY}>${esc(s.id)}</sts:SoftwareID></sts:SoftwareProvider>`
    + `<sts:SoftwareSecurityCode ${DIAN_AGENCY}>${codigoSeguridad(s.id, s.pin, opts.numero)}</sts:SoftwareSecurityCode>`
    + `<sts:AuthorizationProvider><sts:AuthorizationProviderID ${DIAN_AGENCY} schemeID="4" schemeName="31">${NIT_DIAN}</sts:AuthorizationProviderID></sts:AuthorizationProvider>`
    + `<sts:QRCode>${esc(urlQr(opts.codigo, opts.ambiente))}</sts:QRCode>`
    + '</sts:DianExtensions></ext:ExtensionContent></ext:UBLExtension>'
    // Aquí va ds:Signature cuando se firme el documento.
    + '<ext:UBLExtension><ext:ExtensionContent></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>';
}

const NS = 'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '
  + 'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" '
  + 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" '
  + 'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" '
  + 'xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1" '
  + 'xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#" '
  + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

function datosCodigo(d: Comun, numero: string, t: Totales): DatosCodigo {
  const de = (id: string) => money(t.impuestos.filter((i) => i.tributo.id === id).reduce((a, i) => a + i.valor, 0));
  return {
    numero, fecha: d.fecha, hora: d.hora, valFac: money(t.bruto), iva: de('01'), inc: de('04'), ica: de('03'),
    total: money(t.total), nitEmisor: d.emisor.nit, numAdq: d.adquiriente.numero, ambiente: d.ambiente,
  };
}

export interface Documento { xml: string; numero: string; codigo: string; totales: Totales }

/** Factura electrónica de venta, lista para firmar. */
export function generarFactura(f: Factura): Documento {
  validarFactura(f);
  const numero = `${f.numeracion.prefijo}${f.numero}`;
  const t = calcularTotales(f.lineas);
  const codigo = cufe(datosCodigo(f, numero, t), f.numeracion.claveTecnica);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
    + `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ${NS}>`
    + extensiones({ control: f.numeracion, software: f.software, numero, codigo, ambiente: f.ambiente })
    + '<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID><cbc:CustomizationID>10</cbc:CustomizationID>'
    + '<cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>'
    + `<cbc:ProfileExecutionID>${f.ambiente}</cbc:ProfileExecutionID><cbc:ID>${esc(numero)}</cbc:ID>`
    + `<cbc:UUID schemeID="${f.ambiente}" schemeName="CUFE-SHA384">${codigo}</cbc:UUID>`
    + `<cbc:IssueDate>${f.fecha}</cbc:IssueDate><cbc:IssueTime>${f.hora}</cbc:IssueTime><cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>`
    + `${f.nota ? `<cbc:Note>${esc(f.nota)}</cbc:Note>` : ''}<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>`
    + `<cbc:LineCountNumeric>${f.lineas.length}</cbc:LineCountNumeric>`
    + emisorXml(f.emisor, f.numeracion.prefijo) + adquirienteXml(f.adquiriente) + pagoXml(f) + impuestosXml(t)
    + totalXml('LegalMonetaryTotal', t, f.anticipo ? toCents(f.anticipo) : 0)
    + lineasXml(t, 'InvoiceLine', 'InvoicedQuantity')
    + '</Invoice>';
  return { xml, numero, codigo, totales: t };
}

function validarNota(n: Nota) {
  validar(n);
  if (n.motivo.trim().length < 20) throw new Error('El motivo de la nota debe tener al menos 20 caracteres.');
  if (!n.factura.cufe) throw new Error('La nota debe indicar el CUFE de la factura que corrige.');
}

function referenciaXml(n: Nota) {
  return `<cac:DiscrepancyResponse><cbc:ReferenceID>${esc(n.factura.numero)}</cbc:ReferenceID><cbc:ResponseCode>${esc(n.concepto)}</cbc:ResponseCode>`
    + `<cbc:Description>${esc(n.motivo)}</cbc:Description></cac:DiscrepancyResponse>`
    + `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(n.factura.numero)}</cbc:ID>`
    + `<cbc:UUID schemeName="CUFE-SHA384">${esc(n.factura.cufe)}</cbc:UUID><cbc:IssueDate>${esc(n.factura.fecha)}</cbc:IssueDate>`
    + '</cac:InvoiceDocumentReference></cac:BillingReference>';
}

function encabezadoNota(n: Nota, numero: string, codigo: string, custom: string, perfil: string) {
  return extensiones({ software: n.software, numero, codigo, ambiente: n.ambiente })
    + `<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID><cbc:CustomizationID>${custom}</cbc:CustomizationID>`
    + `<cbc:ProfileID>${perfil}</cbc:ProfileID><cbc:ProfileExecutionID>${n.ambiente}</cbc:ProfileExecutionID><cbc:ID>${esc(numero)}</cbc:ID>`
    + `<cbc:UUID schemeID="${n.ambiente}" schemeName="CUDE-SHA384">${codigo}</cbc:UUID>`
    + `<cbc:IssueDate>${n.fecha}</cbc:IssueDate><cbc:IssueTime>${n.hora}</cbc:IssueTime>`;
}

/** Nota crédito que referencia una factura electrónica (CustomizationID 20). */
export function generarNotaCredito(n: Nota): Documento {
  validarNota(n);
  const numero = `${n.prefijo}${n.numero}`;
  const t = calcularTotales(n.lineas);
  const codigo = cude(datosCodigo(n, numero, t), n.software.pin);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
    + `<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" ${NS}>`
    + encabezadoNota(n, numero, codigo, '20', 'DIAN 2.1: Nota Crédito de Factura Electrónica de Venta')
    + `<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>${n.nota ? `<cbc:Note>${esc(n.nota)}</cbc:Note>` : ''}`
    + `<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode><cbc:LineCountNumeric>${n.lineas.length}</cbc:LineCountNumeric>`
    + referenciaXml(n) + emisorXml(n.emisor, n.prefijo) + adquirienteXml(n.adquiriente) + pagoXml(n) + impuestosXml(t)
    + totalXml('LegalMonetaryTotal', t) + lineasXml(t, 'CreditNoteLine', 'CreditedQuantity')
    + '</CreditNote>';
  return { xml, numero, codigo, totales: t };
}

/** Nota débito que referencia una factura electrónica (CustomizationID 30). */
export function generarNotaDebito(n: Nota): Documento {
  validarNota(n);
  const numero = `${n.prefijo}${n.numero}`;
  const t = calcularTotales(n.lineas);
  const codigo = cude(datosCodigo(n, numero, t), n.software.pin);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
    + `<DebitNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2" ${NS}>`
    + encabezadoNota(n, numero, codigo, '30', 'DIAN 2.1: Nota Débito de Factura Electrónica de Venta')
    + `${n.nota ? `<cbc:Note>${esc(n.nota)}</cbc:Note>` : ''}`
    + `<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode><cbc:LineCountNumeric>${n.lineas.length}</cbc:LineCountNumeric>`
    + referenciaXml(n) + emisorXml(n.emisor, n.prefijo) + adquirienteXml(n.adquiriente) + pagoXml(n) + impuestosXml(t)
    + totalXml('RequestedMonetaryTotal', t) + lineasXml(t, 'DebitNoteLine', 'DebitedQuantity')
    + '</DebitNote>';
  return { xml, numero, codigo, totales: t };
}
