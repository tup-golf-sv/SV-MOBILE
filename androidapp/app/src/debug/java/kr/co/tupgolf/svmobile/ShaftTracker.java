package kr.co.tupgolf.svmobile;

final class ShaftTracker {
    static final class Line {
        final float x, y, endX, endY;
        final double angle;
        Line(float x, float y, double angle, double length) {
            this.x = x;
            this.y = y;
            this.angle = angle;
            endX = x + (float) (Math.cos(angle) * length);
            endY = y + (float) (Math.sin(angle) * length);
        }
    }

    private static final int DIRECTIONS = 144;
    private static final int SAMPLES = 16;

    // Look for a thin, coherent contrast ridge starting near the player's grip.
    static Line find(int[] pixels, int width, int height, float gripX, float gripY, float body,
                     Line previous) {
        if (!(body >= 28) || !Float.isFinite(gripX) || !Float.isFinite(gripY)) return null;
        double start = body * .29, step = body * .083;
        double[] scores = new double[DIRECTIONS];
        int[] lengths = new int[DIRECTIONS];
        int best = 0;
        for (int direction = 0; direction < DIRECTIONS; direction++) {
            double angle = direction * (2 * Math.PI / DIRECTIONS);
            double dx = Math.cos(angle), dy = Math.sin(angle);
            int positive = 0, negative = 0, misses = 0;
            double strength = 0;
            for (int i = 0; i < SAMPLES; i++) {
                double x = gripX + (start + i * step) * dx;
                double y = gripY + (start + i * step) * dy;
                if (x < 6 || x >= width - 6 || y < 6 || y >= height - 6) break;
                int center = luma(pixels, width, x, y);
                int left = center - luma(pixels, width, x - 4 * dy, y + 4 * dx);
                int right = center - luma(pixels, width, x + 4 * dy, y - 4 * dx);
                int contrast = Math.min(Math.abs(left), Math.abs(right));
                if (left * right > 0 && contrast >= 15) {
                    if (left > 0) positive++; else negative++;
                    strength += Math.min(contrast, 110);
                    lengths[direction] = i + 1;
                    misses = 0;
                } else if (++misses >= 4) {
                    break;
                }
            }
            int hits = Math.max(positive, negative);
            int length = lengths[direction];
            if (hits < 9 || hits < length * .70) continue;
            scores[direction] = hits * strength / (positive + negative);
            if (previous != null && angleDistance(angle, previous.angle) <= Math.PI / 7) {
                scores[direction] *= 1.12;
            }
            if (scores[direction] > scores[best]) best = direction;
        }
        if (scores[best] < 200) return null;
        for (int i = 0; i < DIRECTIONS; i++) {
            int distance = Math.abs(i - best);
            if (Math.min(distance, DIRECTIONS - distance) > 5 && scores[i] >= scores[best] * .88) {
                return null;
            }
        }
        return new Line(gripX, gripY, best * (2 * Math.PI / DIRECTIONS),
                start + (lengths[best] - 1) * step);
    }

    static boolean continuous(Line a, Line b) {
        return a != null && b != null && angleDistance(a.angle, b.angle) <= Math.PI / 4;
    }

    private static double angleDistance(double a, double b) {
        double difference = Math.abs(a - b);
        return Math.min(difference, 2 * Math.PI - difference);
    }

    private static int luma(int[] pixels, int width, double x, double y) {
        int argb = pixels[(int) Math.round(y) * width + (int) Math.round(x)];
        return (77 * ((argb >> 16) & 255) + 150 * ((argb >> 8) & 255) + 29 * (argb & 255)) >> 8;
    }
}
