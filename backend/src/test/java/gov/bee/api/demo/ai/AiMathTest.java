package gov.bee.api.demo.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.Deflater;
import org.junit.jupiter.api.Test;

class AiMathTest {

    @Test
    void zScoreIqrAndRegression() {
        double[] v = {10, 12, 11, 13, 12};
        assertEquals(11.6, AiMath.mean(v), 1e-9);
        assertTrue(AiMath.z(40, v) > 10);
        assertEquals(0, AiMath.z(5, new double[] {3, 3, 3}));
        double[] f = AiMath.fences(new double[] {500, 540, 2100, 520, 510, 530});
        assertTrue(2100 > f[1] && 540 < f[1]);
        double[] fit = AiMath.ols(new double[] {0, 1, 2, 3}, new double[] {1, 3, 5, 7});
        assertEquals(1.0, fit[0], 1e-9);
        assertEquals(2.0, fit[1], 1e-9);
        assertEquals(0.0, fit[2], 1e-9);
    }

    @Test
    void retrievalRanksTheRelevantArticleFirst() {
        List<String> docs = List.of("How do I pay the application fee? The fee is paid at the simulated gateway.",
            "How do I check a certificate? Use the public verifier and the QR code.", "Brand registration filing and review.");
        double[] s = AiMath.tfidfCosine("how do I pay my fee", docs);
        assertTrue(s[0] > s[1] && s[0] > s[2]);
        assertEquals(0.0, AiMath.tfidfCosine("zzzz qqqq", docs)[0]);
    }

    private static byte[] pdf(String content, boolean flate) throws Exception {
        byte[] raw = content.getBytes(StandardCharsets.ISO_8859_1);
        byte[] body = raw;
        if (flate) {
            Deflater d = new Deflater();
            d.setInput(raw);
            d.finish();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            while (!d.finished()) {
                b.write(buf, 0, d.deflate(buf));
            }
            body = b.toByteArray();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(("%PDF-1.4\n1 0 obj\n<< /Length " + body.length + (flate ? " /Filter /FlateDecode" : "") + " >>\nstream\n").getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.write("\nendstream\nendobj\n%%EOF\n".getBytes(StandardCharsets.ISO_8859_1));
        return out.toByteArray();
    }

    @Test
    void readsTextFromPlainAndCompressedPdfAndFindsTheFields() throws Exception {
        String content = "BT /F1 12 Tf 72 700 Td (Laboratory: Synthetic Test Laboratory) Tj T* (Date of test: 14 August 2026) Tj "
            + "T* [(Measured ISEER: 4) 20 (.62)] TJ ET";
        for (boolean flate : new boolean[] {false, true}) {
            String text = ReportText.extract(pdf(content, flate));
            ReportText.Fields f = ReportText.fields(text);
            assertEquals("Synthetic Test Laboratory", f.laboratory().value());
            assertEquals("2026-08-14", f.testDate().value());
            assertEquals("4.62", f.efficiency().value());
        }
        assertEquals("", ReportText.extract("not a pdf".getBytes(StandardCharsets.UTF_8)));
        assertNull(ReportText.fields("nothing useful here").laboratory());
        assertNotNull(ReportText.fields("tested at: Some Lab").laboratory());
    }
}
