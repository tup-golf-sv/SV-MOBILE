package kr.co.tupgolf.svmobile;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

final class SwingAnalysisRegression {
    public static void main(String[] args) {
        double[] swing = {0, .01, .02, .18, .34, .6, .92, 1.25, 1.4, 1.25, .85, .42, .06,
                .35, .7, 1, 1.13, 1.15, 1.12, 1.13, 1.11, 1.12};
        var normal = samples(swing, 50, 1);
        var mirrored = samples(swing, 75, -1);
        var first = SwingPhases.detect(normal);
        var second = SwingPhases.detect(mirrored);
        require(first != null && second != null, "complete swing and mirrored swing");
        require(Arrays.equals(first.frames, new int[]{2, 3, 8, 10, 12, 17}), "phase indices");
        require(Arrays.equals(first.frames, second.frames), "compare matched phases at different speeds");
        require(first.time(SwingPhases.Phase.IMPACT, normal) == 600, "first impact time");
        require(second.time(SwingPhases.Phase.IMPACT, mirrored) == 900, "second impact time");
        require(first.tempo == 1.5 && second.tempo == 1.5, "normalized tempo");
        double[] slowMotion = new double[(swing.length - 1) * 4 + 1];
        for (int i = 0; i < slowMotion.length; i++) {
            int a = i / 4, b = Math.min(a + 1, swing.length - 1);
            slowMotion[i] = swing[a] + (swing[b] - swing[a]) * ((i % 4) / 4.0);
        }
        var slow = SwingPhases.detect(samples(slowMotion, 50, 1));
        require(slow != null && Math.abs(slow.frames[SwingPhases.Phase.IMPACT.ordinal()] - 48) <= 3,
                "slow-motion fallback retains impact location");
        require(SwingPhases.detect(samples(new double[30], 50, 1)) == null, "still frame");
        require(SwingPhases.detect(samples(Arrays.copyOf(swing, 14), 50, 1)) == null, "no finish");
        normal.set(9, null);
        normal.set(10, null);
        require(SwingPhases.detect(normal) == null, "missing downswing landmarks");
        testShaft();
        System.out.println("Swing analysis regression checks passed");
    }

    private static void testShaft() {
        int width = 240, height = 240;
        int[] pixels = new int[width * height];
        Arrays.fill(pixels, 0x484848);
        require(ShaftTracker.find(pixels, width, height, 70, 120, 65, null) == null, "no shaft");
        for (int x = 72; x < 175; x++) pixels[120 * width + x] = 0xffffff;
        var line = ShaftTracker.find(pixels, width, height, 70, 120, 65, null);
        require(line != null && line.endX > 140 && Math.abs(line.endY - 120) < 3, "thin shaft");
        require(ShaftTracker.continuous(line, line), "neighboring agreement");
        for (int y = 123; y < 228; y++) pixels[y * width + 70] = 0xffffff;
        require(ShaftTracker.find(pixels, width, height, 70, 120, 65, null) == null,
                "withhold ambiguous shaft direction");
    }

    private static List<SwingPhases.Sample> samples(double[] values, int step, int direction) {
        List<SwingPhases.Sample> samples = new ArrayList<>();
        for (int i = 0; i < values.length; i++) {
            samples.add(new SwingPhases.Sample((long) i * step, direction * values[i] * .6, -values[i] * .8));
        }
        return samples;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
