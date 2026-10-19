package kr.taezil.heroesquizauto;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class QuizDatabase {
    public static final class Match {
        public final String question;
        public final String answer;
        public final double score;
        Match(String question, String answer, double score) {
            this.question = question;
            this.answer = answer;
            this.score = score;
        }
    }

    private static final class Qa {
        final String q;
        final String a;
        final String nq;
        Qa(String q, String a) {
            this.q = q;
            this.a = a;
            this.nq = normalize(q);
        }
    }

    private final Context context;
    private final List<Qa> items = new ArrayList<>();

    public QuizDatabase(Context context) {
        this.context = context.getApplicationContext();
        reload();
    }

    public synchronized void reload() {
        items.clear();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(
                context.getAssets().open("qa.tsv"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                String[] p = line.split("\\t", 2);
                if (p.length == 2 && !p[0].trim().isEmpty() && !p[1].trim().isEmpty()) {
                    items.add(new Qa(p[0].trim(), p[1].trim()));
                }
            }
        } catch (Exception ignored) {}

        SharedPreferences sp = context.getSharedPreferences("qa_custom", Context.MODE_PRIVATE);
        Set<String> custom = sp.getStringSet("pairs", new HashSet<>());
        for (String s : custom) {
            String[] p = s.split("\\t", 2);
            if (p.length == 2) items.add(new Qa(p[0], p[1]));
        }
    }

    public synchronized int size() { return items.size(); }

    public synchronized void add(String q, String a) {
        if (q == null || a == null || q.trim().isEmpty() || a.trim().isEmpty()) return;
        SharedPreferences sp = context.getSharedPreferences("qa_custom", Context.MODE_PRIVATE);
        Set<String> set = new HashSet<>(sp.getStringSet("pairs", new HashSet<>()));
        set.add(q.trim() + "\t" + a.trim());
        sp.edit().putStringSet("pairs", set).apply();
        reload();
    }

    public synchronized int importTsv(String text) {
        if (text == null) return 0;
        int count = 0;
        SharedPreferences sp = context.getSharedPreferences("qa_custom", Context.MODE_PRIVATE);
        Set<String> set = new HashSet<>(sp.getStringSet("pairs", new HashSet<>()));
        for (String raw : text.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            String[] p = line.contains("\t") ? line.split("\\t", 2) : line.split("\\|", 2);
            if (p.length != 2) continue;
            String q = p[0].trim();
            String a = p[1].trim();
            if (!q.isEmpty() && !a.isEmpty()) {
                if (set.add(q + "\t" + a)) count++;
            }
        }
        sp.edit().putStringSet("pairs", set).apply();
        reload();
        return count;
    }

    public synchronized Match findBest(String question) {
        String nq = normalize(question);
        if (nq.length() < 4) return null;
        Match best = null;
        for (Qa qa : items) {
            double score = similarity(nq, qa.nq);
            if (best == null || score > best.score) best = new Match(qa.q, qa.a, score);
        }
        return best;
    }

    public static String normalize(String s) {
        if (s == null) return "";
        String x = s.toLowerCase(Locale.KOREA)
                .replace('0', 'o')
                .replace("oooo", "")
                .replace("ooo", "")
                .replace("oo", "");
        return x.replaceAll("[^0-9a-z가-힣]", "");
    }

    private static double similarity(String a, String b) {
        if (a.equals(b)) return 1.0;
        if (a.length() < 2 || b.length() < 2) return a.equals(b) ? 1.0 : 0.0;
        Set<String> aa = bigrams(a);
        Set<String> bb = bigrams(b);
        int inter = 0;
        for (String g : aa) if (bb.contains(g)) inter++;
        int union = aa.size() + bb.size() - inter;
        double jaccard = union == 0 ? 0 : (double) inter / union;

        int dist = levenshtein(a, b);
        double lev = 1.0 - (double) dist / Math.max(a.length(), b.length());
        return 0.60 * lev + 0.40 * jaccard;
    }

    private static Set<String> bigrams(String s) {
        Set<String> set = new HashSet<>();
        for (int i = 0; i < s.length() - 1; i++) set.add(s.substring(i, i + 2));
        return set;
    }

    private static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[b.length()];
    }
}
