package kr.co.tupgolf.svmobile;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.Arrays;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

@RunWith(AndroidJUnit4.class)
public final class SwingAnalysisSmokeTest {
    @Test public void analysisScreenOpensWithSeparateAAndBControls() {
        try (ActivityScenario<SwingAnalysisActivity> scenario =
                     ActivityScenario.launch(SwingAnalysisActivity.class)) {
            scenario.onActivity(activity -> {
                View root = activity.findViewById(android.R.id.content);
                assertTrue(hasButton(root, "A 영상 선택", true));
                assertTrue(hasButton(root, "B 영상 선택", true));
                assertTrue(hasButton(root, "임팩트 추정", false));
            });
        }
    }

    @Test public void optionalVideoFixturesUseTheAndroidDecoderAndPoseModel() throws Exception {
        String fixtures = InstrumentationRegistry.getArguments().getString("fixtures", "");
        assumeTrue("Provide comma-separated cache filenames in the fixtures argument", !fixtures.isEmpty());
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String name : fixtures.split(",")) {
            assertTrue(name.matches("[a-zA-Z0-9_.-]+"));
            File file = new File(app.getCacheDir(), name);
            assertTrue("Missing fixture " + name, file.isFile());
            SwingVideoAnalyzer.Result result = SwingVideoAnalyzer.analyze(
                    app, Uri.fromFile(file), progress -> {});
            Log.i("SwingAnalysisTest", name + " pose=" + result.valid + "/" + result.samples
                    + " phases=" + Arrays.toString(result.times) + " shafts=" + result.shafts);
            assertTrue("Video frames must be decoded", result.samples > 0);
            if (name.startsWith("blank")) {
                assertEquals("Blank video has no golfer", 0, result.valid);
                assertNull(result.phases);
            } else {
                assertTrue("Real clip must contain pose landmarks", result.valid > 0);
                assertNotNull("Complete swing has phases", result.phases);
                assertEquals(6, result.times.length);
                for (int i = 0; i < result.times.length; i++) {
                    assertNotNull(result.previews[i]);
                    if (i > 0) assertTrue(result.times[i] > result.times[i - 1]);
                }
            }
        }
    }

    private static boolean hasButton(View view, String label, boolean enabled) {
        if (view instanceof Button button && label.contentEquals(button.getText())) {
            return enabled == button.isEnabled();
        }
        if (view instanceof ViewGroup group) {
            for (int i = 0; i < group.getChildCount(); i++) {
                if (hasButton(group.getChildAt(i), label, enabled)) return true;
            }
        }
        return false;
    }
}
