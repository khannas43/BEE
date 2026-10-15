package gov.bee.api.demo.ai;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Small, dependency-free statistics and retrieval helpers for the AI demonstration. Pure functions, deterministic. */
final class AiMath {

    private AiMath() {
    }

    static double mean(double[] v) {
        if (v.length == 0) {
            return 0;
        }
        double s = 0;
        for (double x : v) {
            s += x;
        }
        return s / v.length;
    }

    /** Sample standard deviation (n - 1); 0 for fewer than two values. */
    static double sd(double[] v) {
        if (v.length < 2) {
            return 0;
        }
        double m = mean(v);
        double s = 0;
        for (double x : v) {
            s += (x - m) * (x - m);
        }
        return Math.sqrt(s / (v.length - 1));
    }

    /** z-score of x against a reference sample; 0 when the reference has no spread. */
    static double z(double x, double[] reference) {
        double sd = sd(reference);
        return sd == 0 ? 0 : (x - mean(reference)) / sd;
    }

    /** Linear-interpolated quantile (q in 0..1) of an unsorted array. */
    static double quantile(double[] v, double q) {
        if (v.length == 0) {
            return 0;
        }
        double[] s = v.clone();
        Arrays.sort(s);
        double pos = q * (s.length - 1);
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        return s[lo] + (s[hi] - s[lo]) * (pos - lo);
    }

    /** Tukey fences {lower, upper} with k = 1.5. */
    static double[] fences(double[] v) {
        double q1 = quantile(v, 0.25);
        double q3 = quantile(v, 0.75);
        double iqr = q3 - q1;
        return new double[] {q1 - 1.5 * iqr, q3 + 1.5 * iqr};
    }

    /** Ordinary least squares y = a + b x. Returns {intercept, slope, residual standard error, n, mean x, sum of squared x deviations}. */
    static double[] ols(double[] x, double[] y) {
        int n = x.length;
        double mx = mean(x);
        double my = mean(y);
        double sxx = 0;
        double sxy = 0;
        for (int i = 0; i < n; i++) {
            sxx += (x[i] - mx) * (x[i] - mx);
            sxy += (x[i] - mx) * (y[i] - my);
        }
        double b = sxx == 0 ? 0 : sxy / sxx;
        double a = my - b * mx;
        double sse = 0;
        for (int i = 0; i < n; i++) {
            double e = y[i] - (a + b * x[i]);
            sse += e * e;
        }
        double se = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
        return new double[] {a, b, se, n, mx, sxx};
    }

    static double round(double v, int places) {
        double f = Math.pow(10, places);
        return Math.round(v * f) / f;
    }

    // ---- retrieval -------------------------------------------------------------------------------------------------------------

    private static final Set<String> STOP = new HashSet<>(Arrays.asList(
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "it", "my", "i", "do", "does", "how", "what", "why", "can", "for",
        "with", "that", "this", "be", "by", "as", "at", "from", "you", "your", "me", "not", "if", "when", "will", "was", "have", "has"));

    static List<String> tokens(String text) {
        List<String> out = new ArrayList<>();
        for (String t : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (t.length() > 1 && !STOP.contains(t)) {
                out.add(stem(t));
            }
        }
        return out;
    }

    private static String stem(String t) {
        for (String suffix : new String[] {"ing", "ed", "es", "s"}) {
            if (t.length() > suffix.length() + 3 && t.endsWith(suffix)) {
                return t.substring(0, t.length() - suffix.length());
            }
        }
        return t;
    }

    /** TF-IDF cosine similarity of the query against each document, in document order (smoothed idf, fitted on the documents). */
    static double[] tfidfCosine(String query, List<String> docs) {
        List<List<String>> toks = new ArrayList<>();
        Map<String, Integer> df = new HashMap<>();
        for (String d : docs) {
            List<String> t = tokens(d);
            toks.add(t);
            for (String w : new HashSet<>(t)) {
                df.merge(w, 1, Integer::sum);
            }
        }
        int n = docs.size();
        Map<String, Double> q = vector(tokens(query), df, n);
        double[] scores = new double[n];
        for (int i = 0; i < n; i++) {
            scores[i] = cosine(q, vector(toks.get(i), df, n));
        }
        return scores;
    }

    private static Map<String, Double> vector(List<String> tokens, Map<String, Integer> df, int n) {
        Map<String, Double> tf = new HashMap<>();
        for (String t : tokens) {
            tf.merge(t, 1.0, Double::sum);
        }
        Map<String, Double> v = new HashMap<>();
        tf.forEach((w, c) -> v.put(w, (1 + Math.log(c)) * (Math.log((n + 1.0) / (df.getOrDefault(w, 0) + 1.0)) + 1)));
        return v;
    }

    private static double cosine(Map<String, Double> a, Map<String, Double> b) {
        double dot = 0;
        for (Map.Entry<String, Double> e : a.entrySet()) {
            Double o = b.get(e.getKey());
            if (o != null) {
                dot += e.getValue() * o;
            }
        }
        double na = norm(a);
        double nb = norm(b);
        return na == 0 || nb == 0 ? 0 : dot / (na * nb);
    }

    private static double norm(Map<String, Double> v) {
        double s = 0;
        for (double x : v.values()) {
            s += x * x;
        }
        return Math.sqrt(s);
    }
}
