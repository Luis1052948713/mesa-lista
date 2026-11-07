// Pruebas de la facturación electrónica DIAN. Corre con: npm run test:logic
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  calcularTotales, codigoSeguridad, CONSUMIDOR_FINAL, cude, cufe, generarFactura, generarNotaCredito, generarNotaDebito,
  nombreArchivo, sha384, TRIBUTOS, urlQr, valor,
} from '../src/lib/dian.ts';

// Revisa que las etiquetas abran y cierren bien.
function bienFormado(xml: string) {
  const pila: string[] = [];
  for (const m of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[1]) assert.equal(pila.pop(), m[2], `cierre inesperado de ${m[2]}`);
    else if (!m[3]) pila.push(m[2]);
  }
  assert.equal(pila.length, 0, `sin cerrar: ${pila.join(',')}`);
}
const tag = (xml: string, name: string) => new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml)?.[1];

const direccion = { municipioCodigo: '13001', municipio: 'Cartagena', departamentoCodigo: '13', departamento: 'Bolívar', linea: 'Calle 20 # 1-2' };
const base = {
  ambiente: 2 as const, numero: 990000001, fecha: '2026-11-06', hora: '19:30:00-05:00',
  emisor: { nit: '900123456', dv: '7', razonSocial: 'Fogón & Sazón S.A.S.', tipoPersona: '1' as const, obligaciones: 'O-13', tributo: TRIBUTOS.inc, direccion },
  adquiriente: CONSUMIDOR_FINAL,
  software: { id: 'soft-123', pin: '54321', nitProveedor: '900123456', dvProveedor: '7' },
  lineas: [
    { descripcion: 'Bandeja paisa', cantidad: 2, precio: 47000, impuesto: { tributo: TRIBUTOS.inc, tarifa: 8 } },
    { descripcion: 'Limonada <natural>', cantidad: 3, precio: 8333, impuesto: { tributo: TRIBUTOS.inc, tarifa: 8 } },
  ],
};
const numeracion = { prefijo: 'SETP', autorizacion: '18760000001', inicio: '2019-01-19', fin: '2030-01-19', desde: 990000000, hasta: 995000000, claveTecnica: 'clave-prueba' };
const factura = { ...base, numeracion };

test('CUFE y CUDE dan lo mismo que los ejemplos del anexo técnico', () => {
  assert.equal(cufe({
    numero: '323200000129', fecha: '2019-01-16', hora: '10:53:10-05:00', valFac: '1500000.00', iva: '285000.00', inc: '0.00', ica: '0.00',
    total: '1785000.00', nitEmisor: '700085371', numAdq: '800199436', ambiente: 1,
  }, '693ff6f2a553c3646a063436fd4dd9ded0311471'),
  '8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4');
  assert.equal(cude({
    numero: '8110007871', fecha: '2019-02-20', hora: '16:46:55-05:00', valFac: '235.28', iva: '19.00', inc: '0.00', ica: '8.28',
    total: '262.56', nitEmisor: '900373076', numAdq: '8355990', ambiente: 2,
  }, '12345'),
  '955327eb55f8bdf16d069358a063d87e1577a292cb088ec186ed60bbc38e750b7b3980659b278ead789b95f9c51a9ef7');
});

test('valores, nombres de archivo y URL del QR', () => {
  assert.equal(valor(1500000), '1500000.00');
  assert.equal(valor(10.129), '10.12', 'trunca, no redondea');
  assert.equal(codigoSeguridad('id', '12345', 'SETP1'), sha384('id12345SETP1'));
  assert.equal(nombreArchivo('fv', '800197268', 2019, 11), 'fv08001972680001900000011.xml');
  assert.equal(nombreArchivo('nc', '800197268', 2019, 1), 'nc08001972680001900000001.xml');
  assert.equal(nombreArchivo('z', '800197268', 2019, 11), 'z08001972680001900000011.zip');
  assert.ok(urlQr('abc', 2).startsWith('https://catalogo-vpfe-hab.dian.gov.co/'));
  assert.ok(urlQr('abc', 1).startsWith('https://catalogo-vpfe.dian.gov.co/'));
});

test('genera la factura con totales exactos y su CUFE', () => {
  const d = generarFactura({ ...factura, anticipo: 50000 });
  bienFormado(d.xml);
  // 2 × 47.000 + 3 × 8.333 = 118.999; INC 8 % = 9.519,92
  assert.equal(tag(d.xml, 'cbc:PayableAmount'), '128518.92', 'el anticipo no se resta del valor a pagar');
  assert.equal(tag(d.xml, 'cbc:PrepaidAmount'), '50000.00');
  assert.equal(tag(d.xml, 'cbc:TaxExclusiveAmount'), '118999.00');
  assert.equal(tag(d.xml, 'cbc:LineCountNumeric'), '2');
  assert.equal(d.numero, 'SETP990000001');
  assert.equal(d.codigo, cufe({
    numero: 'SETP990000001', fecha: '2026-11-06', hora: '19:30:00-05:00', valFac: '118999.00', iva: '0.00', inc: '9519.92', ica: '0.00',
    total: '128518.92', nitEmisor: '900123456', numAdq: '222222222222', ambiente: 2,
  }, 'clave-prueba'));
  assert.ok(d.xml.includes(`<cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${d.codigo}</cbc:UUID>`));
  assert.ok(d.xml.includes('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>'));
  assert.ok(d.xml.includes('Fogón &amp; Sazón') && d.xml.includes('Limonada &lt;natural&gt;'), 'escapa los caracteres especiales');
  assert.ok(!d.xml.includes('54321') && !d.xml.includes('clave-prueba'), 'el PIN y la clave técnica no viajan en el XML');
  assert.ok(d.xml.indexOf('<cac:AccountingSupplierParty>') < d.xml.indexOf('<cac:LegalMonetaryTotal>'));
  assert.ok(d.xml.indexOf('<cac:LegalMonetaryTotal>') < d.xml.indexOf('<cac:InvoiceLine>'));
});

test('separa tarifas y líneas sin impuesto', () => {
  const t = calcularTotales([
    { descripcion: 'A', cantidad: 1, precio: 1000, impuesto: { tributo: TRIBUTOS.inc, tarifa: 8 } },
    { descripcion: 'B', cantidad: 1, precio: 1000, impuesto: { tributo: TRIBUTOS.iva, tarifa: 19 } },
    { descripcion: 'C', cantidad: 1, precio: 1000, impuesto: null },
  ]);
  assert.equal(t.bruto, 300000);
  assert.equal(t.baseImponible, 200000, 'lo que no lleva impuesto no entra en la base');
  assert.equal(t.total, 327000);
  assert.equal(t.impuestos.length, 2);
});

test('notas crédito y débito usan CUDE y referencian la factura', () => {
  const fac = generarFactura(factura);
  const nota = {
    ...base, prefijo: 'NC', numero: 1, concepto: '2', motivo: 'Anulación de la factura por error en el pedido',
    factura: { numero: fac.numero, cufe: fac.codigo, fecha: '2026-11-06' },
  };
  const nc = generarNotaCredito(nota);
  bienFormado(nc.xml);
  assert.ok(nc.xml.includes('schemeName="CUDE-SHA384"') && nc.xml.includes(`schemeName="CUFE-SHA384">${fac.codigo}`));
  assert.ok(nc.xml.includes('<cbc:CreditedQuantity') && nc.xml.includes('<cac:CreditNoteLine>'));
  assert.ok(nc.xml.indexOf('<cac:DiscrepancyResponse>') < nc.xml.indexOf('<cac:AccountingSupplierParty>'));
  assert.ok(!nc.xml.includes('<sts:InvoiceControl>'));
  const nd = generarNotaDebito({ ...nota, prefijo: 'ND' });
  bienFormado(nd.xml);
  assert.ok(nd.xml.includes('<cac:RequestedMonetaryTotal>') && nd.xml.includes('<cbc:DebitedQuantity'));
  assert.notEqual(nc.codigo, nd.codigo);
});

test('rechaza datos que la validación previa no aceptaría', () => {
  assert.throws(() => generarFactura({ ...factura, numero: 5 }), /fuera del rango/);
  assert.throws(() => generarFactura({ ...factura, fecha: '2031-01-01' }), /vigencia/);
  assert.throws(() => generarFactura({ ...factura, hora: '19:30:00' }), /hora de Colombia/);
  assert.throws(() => generarFactura({ ...factura, lineas: [] }), /al menos un producto/);
  assert.throws(() => generarFactura({ ...factura, emisor: { ...base.emisor, nit: '900.123.456-7' } }), /sin puntos/);
  assert.throws(() => generarFactura({ ...factura, formaPago: '2' }), /vencimiento/);
  assert.throws(() => generarFactura({ ...factura, lineas: [{ ...base.lineas[0], cantidad: 0 }] }), /mayor que cero/);
  assert.throws(() => generarNotaCredito({
    ...base, prefijo: 'NC', numero: 1, concepto: '2', motivo: 'corto', factura: { numero: 'X', cufe: 'y', fecha: '2026-11-06' },
  }), /20 caracteres/);
});
