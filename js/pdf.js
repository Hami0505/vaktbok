// Vaktbok – timeliste som ekte PDF-fil (virker også i appen på hjemskjermen på iPhone, der utskrift ikke finnes).
// jsPDF lastes først når den trengs, og mellomlagres av service workeren etterpå.

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

export function loadJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL; s.async = true;
    s.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jspdf'));
    s.onerror = () => reject(new Error('jspdf'));
    document.head.append(s);
  });
}

// data = { title, employer, period, groups: [{ name, rows: [{ day, start, end, brk, hours }], sum, count }], total, count, single }
// Ren funksjon: tar imot jsPDF-klassen, så den kan testes i Node.
export function buildTimesheetPdf(JsPDF, data) {
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
  const cols = [M, M + 150, M + 230, M + 310, W - M]; // dato, start, slutt, pause, timer (høyrejustert)
  let y = M;
  const line = (yy, gray = 200) => { doc.setDrawColor(gray); doc.setLineWidth(0.6); doc.line(M, yy, W - M, yy); };
  const footer = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Laget med Vaktbok. Timer er etter ubetalt pause.', M, H - 28);
    doc.text(`Side ${doc.getNumberOfPages()}`, W - M, H - 28, { align: 'right' });
    doc.setTextColor(0);
  };
  const ensure = need => { if (y + need > H - 60) { footer(); doc.addPage(); y = M; } };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Timeliste', M, y + 6); y += 34;
  doc.setFontSize(10.5);
  for (const [k, v] of [['Arbeidsgiver', data.employer], ['Periode', data.period], ['Navn', '']]) {
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, M, y);
    doc.setFont('helvetica', 'normal');
    if (v) doc.text(v, M + 80, y); else { doc.setDrawColor(150); doc.line(M + 80, y + 2, M + 300, y + 2); }
    y += 18;
  }
  y += 8;

  const header = () => {
    ensure(40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(90);
    ['Dato', 'Start', 'Slutt', 'Pause'].forEach((h, i) => doc.text(h, cols[i], y));
    doc.text('Timer', cols[4], y, { align: 'right' });
    doc.setTextColor(0); y += 6; line(y, 120); y += 14;
  };

  for (const g of data.groups) {
    if (!data.single) { ensure(60); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text(g.name, M, y); y += 18; }
    header();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    for (const r of g.rows) {
      if (y + 20 > H - 60) { footer(); doc.addPage(); y = M; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); }
      doc.text(r.day, cols[0], y); doc.text(r.start, cols[1], y); doc.text(r.end, cols[2], y);
      doc.text(r.brk, cols[3], y); doc.text(r.hours, cols[4], y, { align: 'right' });
      y += 6; line(y); y += 14;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`Sum (${g.count} ${g.count === 1 ? 'vakt' : 'vakter'})`, cols[0], y); doc.text(g.sum, cols[4], y, { align: 'right' });
    y += 28;
  }
  if (!data.single) { ensure(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(`Totalt: ${data.total} timer (${data.count} vakter)`, M, y); y += 30; }

  ensure(90); y += 40;
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  const half = (W - 2 * M - 30) / 2;
  doc.line(M, y, M + half, y);
  if (data.single) doc.line(M + half + 30, y, W - M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Dato og signatur, arbeidstaker', M, y + 13);
  if (data.single) doc.text('Dato og signatur, arbeidsgiver', M + half + 30, y + 13);
  footer();
  return doc.output('blob');
}

// Deler fila (delingsarket på iPhone/Android) eller laster den ned.
export async function deliverFile(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
