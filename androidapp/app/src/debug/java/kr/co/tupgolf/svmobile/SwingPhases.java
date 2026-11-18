package kr.co.tupgolf.svmobile;

import java.util.List;

final class SwingPhases {
    enum Phase {
        ADDRESS("어드레스"), TAKEAWAY("백스윙 시작"), TOP("백스윙 톱"),
        DOWNSWING("다운스윙"), IMPACT("임팩트 추정"), FINISH("피니시");

        final String label;
        Phase(String label) { this.label = label; }
    }

    static final class Sample {
        final long ms;
        final double x, y;
        Sample(long ms, double x, double y) {
            this.ms = ms;
            this.x = x;
            this.y = y;
        }
    }
    static final class Result {
        final int[] frames;
        final double tempo;
        Result(int[] frames, double tempo) {
            this.frames = frames;
            this.tempo = tempo;
        }
        long time(Phase phase, List<Sample> samples) {
            return samples.get(frames[phase.ordinal()]).ms;
        }
    }

    static Result detect(List<Sample> samples) {
        // Retry time limits for slow-motion clips while preserving source timestamps.
        for (int speed : new int[]{1, 2, 4}) {
            Result result = detect(samples, speed);
            if (result != null) return result;
        }
        return null;
    }

    private static Result detect(List<Sample> samples, int speed) {
        Result best = null;
        double bestExcursion = 0;
        for (int address = 2; address + 8 < samples.size(); address++) {
            Sample origin = samples.get(address);
            Sample prior = samples.get(address - 2);
            if (origin == null || prior == null || origin.ms - prior.ms > 220
                    || distance(origin, prior) > .11
                    || distance(origin, samples.get(address - 1)) > .09) continue;
            int takeaway = address + 1;
            if (samples.get(takeaway) == null || samples.get(takeaway + 1) == null
                    || distance(origin, samples.get(takeaway)) < .13
                    || distance(origin, samples.get(takeaway + 1)) < .19) continue;

            int top = -1;
            double excursion = .55;
            for (int i = takeaway + 1; i + 3 < samples.size(); i++) {
                Sample sample = samples.get(i);
                if (sample == null || sample.ms - origin.ms > 2400L * speed) break;
                double d = distance(origin, sample);
                if (d > excursion) {
                    excursion = d;
                    top = i;
                }
                if (top >= 0 && excursion - d >= .27) break;
            }
            if (top < 0 || samples.get(top).ms - origin.ms < 200
                    || origin.y - samples.get(top).y < .35) continue;

            int impact = -1;
            double nearest = Math.min(.52, excursion * .50);
            for (int i = top + 2; i + 2 < samples.size(); i++) {
                Sample sample = samples.get(i);
                if (sample == null || sample.ms - samples.get(top).ms > 850L * speed) break;
                double d = distance(origin, sample);
                if (d < nearest) {
                    nearest = d;
                    impact = i;
                }
                if (impact >= 0 && d - nearest >= .23) break;
            }
            if (impact < 0) continue;

            int finish = -1;
            double finishDistance = .42;
            for (int i = impact + 2; i < samples.size(); i++) {
                Sample sample = samples.get(i);
                if (sample == null || sample.ms - samples.get(impact).ms > 920L * speed) break;
                double d = distance(origin, sample);
                if (d >= finishDistance && origin.y - sample.y >= .30) {
                    finishDistance = d;
                    finish = i;
                }
                if (finish >= 0 && finishDistance - d > .21) break;
            }
            if (finish < 0 || excursion <= bestExcursion) continue;
            int downswing = (top + impact) / 2;
            if (samples.get(downswing) == null || samples.get(top + 1) == null) continue;
            double tempo = (double) (samples.get(top).ms - origin.ms)
                    / (samples.get(impact).ms - samples.get(top).ms);
            best = new Result(new int[]{address, takeaway, top, downswing, impact, finish}, tempo);
            bestExcursion = excursion;
        }
        return best;
    }

    private static double distance(Sample a, Sample b) {
        return b == null ? Double.POSITIVE_INFINITY : Math.hypot(a.x - b.x, a.y - b.y);
    }
}
