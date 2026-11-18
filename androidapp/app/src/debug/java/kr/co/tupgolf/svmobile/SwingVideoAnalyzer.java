package kr.co.tupgolf.svmobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PointF;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.pose.Pose;
import com.google.mlkit.vision.pose.PoseDetection;
import com.google.mlkit.vision.pose.PoseDetector;
import com.google.mlkit.vision.pose.PoseLandmark;
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.IntConsumer;

final class SwingVideoAnalyzer {
    private static final int STEP_MS = 50;
    private static final int MAX_MS = 12_000;
    private static final float MIN_POINT = .55f;
    private static final int[][] LINKS = {
        {11,12}, {11,13}, {13,15}, {12,14}, {14,16}, {11,23}, {12,24}, {23,24},
        {23,25}, {25,27}, {24,26}, {26,28}, {27,31}, {28,32}
    };

    static final class Result {
        final SwingPhases.Result phases;
        final Bitmap[] previews;
        final long[] times;
        final int samples, valid, shafts;
        Result(SwingPhases.Result phases, Bitmap[] previews, long[] times, int samples,
               int valid, int shafts) {
            this.phases = phases;
            this.previews = previews;
            this.times = times;
            this.samples = samples;
            this.valid = valid;
            this.shafts = shafts;
        }
    }

    private static final class PoseFrame {
        final PointF[] points;
        final SwingPhases.Sample sample;
        final ShaftTracker.Line line;
        PoseFrame(PointF[] points, SwingPhases.Sample sample, ShaftTracker.Line line) {
            this.points = points;
            this.sample = sample;
            this.line = line;
        }
    }

    static Result analyze(Context context, Uri uri, IntConsumer progress) throws Exception {
        PoseDetectorOptions options = new PoseDetectorOptions.Builder()
                .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE).build();
        try (MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                PoseDetector detector = PoseDetection.getClient(options)) {
            retriever.setDataSource(context, uri);
            String durationText = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long duration = durationText == null ? 0 : Long.parseLong(durationText);
            if (duration <= 0) duration = frameDuration(context, uri);
            if (duration < 650 || duration > MAX_MS) {
                throw new IllegalArgumentException("0.65~12초 길이의 스윙 영상 한 개를 선택하세요.");
            }
            return scan(retriever, detector, duration, progress);
        }
    }

    private static long frameDuration(Context context, Uri uri) throws Exception {
        // Browser-recorded WebM can omit a container duration.
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(context, uri, null);
            for (int track = 0; track < extractor.getTrackCount(); track++) {
                String mime = extractor.getTrackFormat(track).getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                extractor.selectTrack(track);
                long maximumUs = -1;
                for (int i = 0; i < 3000; i++) {
                    long sampleUs = extractor.getSampleTime();
                    if (sampleUs < 0) return (maximumUs + 1) / 1000 + STEP_MS;
                    maximumUs = Math.max(maximumUs, sampleUs);
                    if (maximumUs > MAX_MS * 1_000L) return MAX_MS + 1L;
                    extractor.advance();
                }
                return MAX_MS + 1L;
            }
            throw new IllegalArgumentException("영상 트랙을 찾을 수 없습니다.");
        } finally {
            extractor.release();
        }
    }

    private static Result scan(MediaMetadataRetriever retriever, PoseDetector detector,
                               long duration, IntConsumer progress) throws Exception {
        List<PoseFrame> frames = new ArrayList<>();
        List<SwingPhases.Sample> samples = new ArrayList<>();
        int valid = 0;
        int[] pixels = new int[0];
        float bodyScale = 0;
        for (long time = 0; time < duration; time += STEP_MS) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            Bitmap bitmap = frameAt(retriever, time);
            PoseFrame frame = null;
            try {
                if (bitmap != null) {
                    Pose pose = Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)),
                            15, TimeUnit.SECONDS);
                    PointF[] points = points(pose, bitmap.getWidth(), bitmap.getHeight());
                    PointF hips = midpoint(points[23], points[24]);
                    PointF shoulders = midpoint(points[11], points[12]);
                    PointF grip = midpoint(points[15], points[16]);
                    if (hips != null && shoulders != null && grip != null) {
                        float body = (float) Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
                        if (body >= 24) {
                            if (bodyScale == 0) bodyScale = body;
                            float scale = Math.max(bodyScale * .70f, Math.min(body, bodyScale * 1.30f));
                            bodyScale = .94f * bodyScale + .06f * scale;
                            SwingPhases.Sample sample = new SwingPhases.Sample(time,
                                    (grip.x - hips.x) / bodyScale, (grip.y - hips.y) / bodyScale);
                            PoseFrame previous = frames.isEmpty() ? null : frames.get(frames.size() - 1);
                            int width = bitmap.getWidth(), height = bitmap.getHeight();
                            if (pixels.length < width * height) pixels = new int[width * height];
                            bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
                            ShaftTracker.Line line = ShaftTracker.find(pixels, width, height,
                                    grip.x, grip.y, bodyScale, previous == null ? null : previous.line);
                            frame = new PoseFrame(points, sample, line);
                            valid++;
                        }
                    }
                }
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
            frames.add(frame);
            samples.add(frame == null ? null : frame.sample);
            if (frames.size() % 8 == 0) progress.accept((int) (100 * time / duration));
        }
        SwingPhases.Result phases = SwingPhases.detect(samples);
        if (phases == null) return new Result(null, new Bitmap[0], new long[0], frames.size(), valid, 0);
        Bitmap[] previews = new Bitmap[SwingPhases.Phase.values().length];
        long[] times = new long[previews.length];
        int shafts = 0;
        for (SwingPhases.Phase phase : SwingPhases.Phase.values()) {
            int i = phase.ordinal(), frameIndex = phases.frames[i];
            PoseFrame pose = frames.get(frameIndex);
            times[i] = pose.sample.ms;
            ShaftTracker.Line line = continuousLine(frames, frameIndex) ? pose.line : null;
            if (line != null) shafts++;
            Bitmap bitmap = frameAt(retriever, times[i]);
            if (bitmap != null) {
                try { previews[i] = annotate(bitmap, pose.points, line); }
                finally { bitmap.recycle(); }
            }
        }
        return new Result(phases, previews, times, frames.size(), valid, shafts);
    }

    private static Bitmap frameAt(MediaMetadataRetriever retriever, long time) {
        // MediaMetadataRetriever returns the frame with the video's display transform applied.
        Bitmap bitmap = retriever.getScaledFrameAtTime(time * 1000,
                MediaMetadataRetriever.OPTION_CLOSEST, 640, 640);
        if (bitmap != null && bitmap.getConfig() == Bitmap.Config.HARDWARE) {
            Bitmap readable = bitmap.copy(Bitmap.Config.ARGB_8888, false);
            bitmap.recycle();
            return readable;
        }
        return bitmap;
    }

    private static PointF[] points(Pose pose, int width, int height) {
        PointF[] points = new PointF[33];
        for (PoseLandmark landmark : pose.getAllPoseLandmarks()) {
            PointF p = landmark.getPosition();
            int id = landmark.getLandmarkType();
            if (id >= 0 && id < points.length && landmark.getInFrameLikelihood() >= MIN_POINT
                    && p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
                points[id] = p;
            }
        }
        return points;
    }

    private static PointF midpoint(PointF a, PointF b) {
        return a == null || b == null ? null : new PointF((a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    private static boolean continuousLine(List<PoseFrame> frames, int index) {
        ShaftTracker.Line target = frames.get(index).line;
        PoseFrame previous = index == 0 ? null : frames.get(index - 1);
        PoseFrame next = index + 1 == frames.size() ? null : frames.get(index + 1);
        return (previous != null && ShaftTracker.continuous(target, previous.line))
                || (next != null && ShaftTracker.continuous(target, next.line));
    }

    private static Bitmap annotate(Bitmap bitmap, PointF[] joints, ShaftTracker.Line shaft) {
        Bitmap output = bitmap.copy(Bitmap.Config.ARGB_8888, true);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStrokeWidth(3);
        paint.setColor(Color.rgb(64, 236, 200));
        for (int[] pair : LINKS) {
            PointF a = joints[pair[0]], b = joints[pair[1]];
            if (a != null && b != null) canvas.drawLine(a.x, a.y, b.x, b.y, paint);
        }
        for (PointF joint : joints) {
            if (joint != null) canvas.drawCircle(joint.x, joint.y, 3, paint);
        }
        if (shaft != null) {
            paint.setColor(Color.rgb(255, 220, 95));
            paint.setStrokeWidth(4);
            canvas.drawLine(shaft.x, shaft.y, shaft.endX, shaft.endY, paint);
        }
        return output;
    }
}
