package kr.co.tupgolf.svmobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SwingAnalysisActivity extends Activity {
    private static final int PICK_A = 101, PICK_B = 102;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SwingVideoAnalyzer.Result[] results = new SwingVideoAnalyzer.Result[2];
    private final ImageView[] images = new ImageView[2];
    private final TextView[] details = new TextView[2];
    private final Button[] open = new Button[2];
    private final Button[] phases = new Button[SwingPhases.Phase.values().length];
    private TextView status;
    private int selectedPhase;
    private boolean busy, destroyed;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(16), dp(12), dp(16), dp(20));
        body.setBackgroundColor(Color.rgb(244, 248, 246));
        body.setOnApplyWindowInsetsListener((view, insets) -> {
            body.setPadding(dp(16) + insets.getSystemWindowInsetLeft(),
                    dp(12) + insets.getSystemWindowInsetTop(),
                    dp(16) + insets.getSystemWindowInsetRight(),
                    dp(20) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        scroll.addView(body);
        setContentView(scroll);
        TextView title = text("T.UP AI 스윙 분석", 24);
        body.addView(title);
        status = text("0.65~12초 영상 한 개를 A에 추가하세요. 같은 각도의 B 영상을 추가하면 자세를 비교할 수 있습니다.", 15);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(status);

        LinearLayout columns = new LinearLayout(this);
        body.addView(columns);
        for (int i = 0; i < results.length; i++) addColumn(columns, i);

        HorizontalScrollView phaseScroll = new HorizontalScrollView(this);
        LinearLayout phaseBar = new LinearLayout(this);
        phaseScroll.addView(phaseBar);
        body.addView(phaseScroll);
        for (SwingPhases.Phase phase : SwingPhases.Phase.values()) {
            int index = phase.ordinal();
            Button button = new Button(this);
            button.setText(phase.label);
            button.setEnabled(false);
            button.setOnClickListener(v -> { selectedPhase = index; render(); });
            phases[index] = button;
            phaseBar.addView(button);
        }
        body.addView(text("민트색은 관절, 노란색은 샤프트 후보입니다. 임팩트 시점은 손의 이동으로 추정합니다.", 14));
        Intent intent = getIntent();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null && "content".equals(uri.getScheme())) analyze(0, uri);
        }
    }

    private void addColumn(LinearLayout columns, int slot) {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(3), dp(8), dp(3), dp(8));
        columns.addView(column, new LinearLayout.LayoutParams(0, -2, 1));
        Button button = new Button(this);
        button.setText((slot == 0 ? "A" : "B") + " 영상 선택");
        button.setOnClickListener(v -> pick(slot));
        open[slot] = button;
        column.addView(button);
        ImageView image = new ImageView(this);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setContentDescription((slot == 0 ? "A" : "B") + " 스윙 분석 영상");
        image.setBackgroundColor(Color.rgb(19, 34, 29));
        images[slot] = image;
        column.addView(image, new LinearLayout.LayoutParams(-1, dp(245)));
        details[slot] = text("영상 대기", 14);
        column.addView(details[slot]);
    }

    private void pick(int slot) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        startActivityForResult(intent, slot == 0 ? PICK_A : PICK_B);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if ((request == PICK_A || request == PICK_B) && result == RESULT_OK
                && data != null && data.getData() != null) {
            analyze(request == PICK_A ? 0 : 1, data.getData());
        }
    }

    private void analyze(int slot, Uri uri) {
        if (busy || !"content".equals(uri.getScheme())) return;
        busy = true;
        for (Button button : open) button.setEnabled(false);
        status.setText("관절 및 스윙 분석 중…");
        worker.execute(() -> {
            try {
                SwingVideoAnalyzer.Result result = SwingVideoAnalyzer.analyze(getApplicationContext(), uri,
                        progress -> runOnUiThread(() -> {
                            if (!destroyed) status.setText(progress < 0 ? "관절 인식 모델 준비 중…"
                                    : "관절 및 스윙 분석 중 " + progress + "%");
                        }));
                runOnUiThread(() -> {
                    if (destroyed) return;
                    results[slot] = result;
                    finish(result.phases == null
                            ? "완전한 스윙 구간을 찾지 못했습니다. 어드레스부터 피니시까지 담긴 영상을 선택하세요."
                            : "분석 완료 · 구간을 선택하세요.");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (destroyed) return;
                    String message = error instanceof IllegalArgumentException ? error.getMessage() : null;
                    if (error instanceof java.util.concurrent.TimeoutException) {
                        message = "관절 분석 응답이 지연됐습니다. 같은 영상을 다시 선택해 주세요.";
                    }
                    finish(message == null ? "영상을 분석하지 못했습니다. 기기에 저장한 MP4 또는 WebM을 선택하세요." : message);
                });
            }
        });
    }

    private void finish(String message) {
        busy = false;
        for (Button button : open) button.setEnabled(true);
        status.setText(message);
        render();
    }

    private void render() {
        boolean available = false;
        for (int i = 0; i < results.length; i++) {
            SwingVideoAnalyzer.Result item = results[i];
            if (item == null) continue;
            if (item.phases == null) {
                images[i].setImageDrawable(null);
                details[i].setText("구간 판독 실패 · 관절 " + item.valid + "/" + item.samples + " 프레임");
                continue;
            }
            available = true;
            images[i].setImageBitmap(item.previews[selectedPhase]);
            details[i].setText(String.format(Locale.KOREA, "%.2f초 · 템포 %.1f:1\n관절 %d/%d · 샤프트 후보 %d/6",
                    item.times[selectedPhase] / 1000.0, item.phases.tempo, item.valid, item.samples, item.shafts));
        }
        for (int i = 0; i < phases.length; i++) {
            phases[i].setEnabled(available);
            phases[i].setSelected(available && i == selectedPhase);
            phases[i].setAlpha(available && i == selectedPhase ? 1f : .75f);
        }
    }

    private TextView text(String value, int size) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(Color.rgb(27, 48, 42));
        text.setPadding(dp(2), dp(6), dp(2), dp(6));
        return text;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override protected void onDestroy() {
        destroyed = true;
        worker.shutdownNow();
        super.onDestroy();
    }
}
