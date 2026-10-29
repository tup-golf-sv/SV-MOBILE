package kr.co.tupgolf.svmobile;

import android.Manifest;
import android.os.SystemClock;
import android.os.Looper;
import android.util.Log;
import android.database.Cursor;
import android.provider.MediaStore;
import android.view.*;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.rule.GrantPermissionRule;
import org.junit.*;
import org.junit.runner.RunWith;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Emulator smoke tests. These do NOT prove real golfer detection or Play payments. */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(org.junit.runners.MethodSorters.NAME_ASCENDING)
public class AndroidSmokeTest {
    @Rule public GrantPermissionRule permissions=GrantPermissionRule.grant(Manifest.permission.CAMERA,Manifest.permission.RECORD_AUDIO);
    private ActivityScenario<MainActivity> scenario;
    private WebView web;
    private volatile String phase="launch",lastExpression="",lastJsResult="";
    private void stage(String value){phase=value;String line="SV_SMOKE_STAGE="+value;System.out.println(line);Log.i("SVSmoke",line);}
    @Before public void launch(){
        stage("activity-launch");
        scenario=ActivityScenario.launch(MainActivity.class);
        scenario.onActivity(a->web=find(a.getWindow().getDecorView()));
        assertNotNull("WebView missing",web);stage("activity-ready");
    }
    @After public void close()throws Exception{
        // ActivityScenario.close itself may block when the UI thread is hung.
        // The shell watchdog terminates this isolated instrumentation process.
        stage("activity-close");if(scenario!=null){
            Thread cleanup=new Thread(()->{try{scenario.close();}catch(Throwable t){Log.w("SVSmoke","activity-close-error",t);}},"sv-smoke-cleanup");
            cleanup.setDaemon(true);cleanup.start();
            cleanup.join(3000);
            if(cleanup.isAlive())Log.e("SVSmoke","SV_ACTIVITY_CLOSE_STALLED phase="+phase);
        }
    }
    private WebView find(View v){if(v instanceof WebView)return (WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=find(g.getChildAt(i));if(w!=null)return w;}}return null;}
    private String js(String source)throws Exception{return js(source,10000);}
    private String js(String source,long budgetMs)throws Exception{
        lastExpression=source;
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        AtomicReference<Throwable> error=new AtomicReference<>();
        AtomicBoolean uiEntered=new AtomicBoolean(false),evaluateReturned=new AtomicBoolean(false);
        // post returns without waiting for UI idleness, unlike onActivity.
        boolean queued=web.post(()->{uiEntered.set(true);try{web.evaluateJavascript(source,r->{result.set(r);latch.countDown();});evaluateReturned.set(true);}catch(Throwable t){error.set(t);latch.countDown();}});
        assertTrue("WebView rejected post; phase="+phase,queued);
        boolean completed=latch.await(Math.max(1,budgetMs),TimeUnit.MILLISECONDS);
        if(!completed){
            String state="phase="+phase+"; uiEntered="+uiEntered.get()+"; evaluateReturned="+evaluateReturned.get();
            Log.e("SVSmoke","SV_JS_TIMEOUT "+state);
            for(StackTraceElement frame:Looper.getMainLooper().getThread().getStackTrace())Log.e("SVSmoke","SV_UI_STACK "+frame);
            fail("WebView callback timed out; "+state+"; expression="+source+"; last="+lastJsResult);
        }
        if(error.get()!=null)throw new AssertionError("WebView evaluation failed; phase="+phase,error.get());
        lastJsResult=result.get();return lastJsResult;
    }
    private void until(String expression,int seconds)throws Exception{
        until(expression,seconds,10000);
    }
    private void until(String expression,int seconds,long callbackBudgetMs)throws Exception{
        long end=SystemClock.elapsedRealtime()+seconds*1000L;String result="";
        while(SystemClock.elapsedRealtime()<end){
            long remaining=end-SystemClock.elapsedRealtime();
            result=js(expression,Math.min(callbackBudgetMs,remaining));if("true".equals(result))return;
            remaining=end-SystemClock.elapsedRealtime();if(remaining>0)Thread.sleep(Math.min(500,remaining));
        }
        // Do not submit more JS to diagnose a renderer that may already be stuck.
        fail("Condition timed out; phase="+phase+"; expression="+expression+"; last="+result);
    }
    @Test public void cCameraReplayAndMediaStoreRoundTrip()throws Exception{
        stage("wait-native-and-model-script");
        until("!!window.__svNativeAdapter && typeof Pose==='function'",60);
        assertEquals("true",js("isSecureContext && !!navigator.mediaDevices.getUserMedia"));
        stage("connect-camera");
        js("document.getElementById('connect').click();true");
        until("typeof stream!=='undefined' && !!stream && raw.videoWidth>0",60);
        stage("camera-connected-wait-model");
        // Model callback proves the unchanged model runs, not that a golfer was detected.
        until("typeof lastPoseRenderAt!=='undefined' && lastPoseRenderAt>0",120,60000);
        stage("model-callback-start-camera-recorder");
        js("window.__smokeError='';(async()=>{try{const r=new MediaRecorder(stream,{mimeType:'video/webm'}),parts=[];r.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};r.onstop=()=>svLoadCapturedFront(new Blob(parts,{type:'video/webm'}));r.start(100);setTimeout(()=>r.stop(),2000);}catch(e){window.__smokeError=e.message;}})();true");
        stage("wait-replay-ready");
        until("!!latestReplayBlob && latestReplayBlob.size>0 && replay.videoWidth>0",30);
        stage("replay-ready-save");
        js("document.getElementById('svMobileSaveBtn').disabled=false;document.getElementById('svMobileSaveBtn').click();true");
        until("document.getElementById('svMobileSaveStatus').textContent.includes('Movies/SV MOBILE')",60);
        stage("native-save-complete");
        AtomicReference<String> saved=new AtomicReference<>();
        scenario.onActivity(a->{try(Cursor c=a.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Video.Media.SIZE,MediaStore.Video.Media.IS_PENDING},MediaStore.Video.Media.RELATIVE_PATH+"=?",new String[]{"Movies/SV MOBILE/"},MediaStore.Video.Media.DATE_ADDED+" DESC")){
            assertNotNull(c);assertTrue(c.moveToFirst());assertTrue(c.getLong(0)>0);assertEquals(0,c.getInt(1));saved.set("saved");
        }});assertEquals("saved",saved.get());
        android.graphics.Bitmap screen=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        java.io.File file=new java.io.File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"android-smoke.png");
        try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){screen.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
        js("document.getElementById('disconnect').click();true");
    }
    /** Exercises production frame buffering/encoding with a forced trigger.
     * Does NOT prove golfer recognition, ADDRESS lock, or automatic detection. */
    @Test public void dActualPreRollCapture()throws Exception{
        stage("preroll-native-ready-forced-trigger-not-golfer-detection");
        until("!!window.__svNativeAdapter && typeof Pose==='function'",60);
        stage("preroll-connect-camera");
        js("document.getElementById('connect').click();true");
        until("typeof stream!=='undefined' && !!stream && raw.videoWidth>0",60);
        long previousId=latestSavedMediaId();
        stage("preroll-arm-and-fill-buffer");
        until("typeof lastPoseRenderAt!=='undefined' && lastPoseRenderAt>0",120,60000);
        js("document.getElementById('arm').click();true");
        until("armed && svRolling.front.length>=20 && svRolling.front[svRolling.front.length-1].t-svRolling.front[0].t>=1200",60);
        String buffer=js("JSON.stringify({frames:svRolling.front.length,spanMs:svRolling.front[svRolling.front.length-1].t-svRolling.front[0].t,width:svRolling.front[0].frame.width,height:svRolling.front[0].frame.height})");
        Log.i("SVSmoke","SV_PREROLL_BUFFER="+buffer);System.out.println("SV_PREROLL_BUFFER="+buffer);
        stage("preroll-force-production-trigger");
        assertEquals("true",js("!svCaptureActive && (latestReplayBlob=null,svStartPreRollCapture(),svCaptureActive)"));
        stage("preroll-wait-production-encode-and-replay");
        until("!!latestReplayBlob && latestReplayBlob.size>0 && replay.videoWidth>0",120);
        Log.i("SVSmoke","SV_PREROLL_REPLAY="+js("JSON.stringify({bytes:latestReplayBlob.size,width:replay.videoWidth,height:replay.videoHeight,duration:replay.duration,result:document.getElementById('result').textContent})"));
        until("!document.getElementById('svMobileSaveBtn').disabled",10);
        stage("preroll-save-production-replay");
        js("document.getElementById('svMobileSaveBtn').click();true");
        until("document.getElementById('svMobileSaveStatus').textContent.includes('Movies/SV MOBILE')",60);
        assertTrue("Save must create a new completed nonempty media row",latestSavedMediaId()>previousId);
        stage("preroll-production-buffer-encode-replay-save-verified-forced-trigger");
        js("document.getElementById('disconnect').click();true");
    }
    private long latestSavedMediaId(){
        android.content.Context context=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
        try(Cursor c=context.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            new String[]{MediaStore.Video.Media._ID,MediaStore.Video.Media.SIZE,MediaStore.Video.Media.IS_PENDING},
            MediaStore.Video.Media.RELATIVE_PATH+"=?",new String[]{"Movies/SV MOBILE/"},MediaStore.Video.Media._ID+" DESC")){
            assertNotNull(c);if(!c.moveToFirst())return -1;
            assertTrue("Saved media must contain bytes",c.getLong(1)>0);assertEquals("Saved media must be finalized",0,c.getInt(2));
            return c.getLong(0);
        }
    }
    @Test public void bCanvasRecordingReplayAndNativeSave()throws Exception{
        stage("canvas-native-ready");
        until("!!window.__svNativeAdapter",60);
        js("window.__saveError='';(async()=>{try{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d'),s=c.captureStream(10),r=new MediaRecorder(s,{mimeType:'video/webm'}),parts=[];let frame=0;const tick=setInterval(()=>{x.fillStyle=frame++%2?'#176647':'#9dcc53';x.fillRect(0,0,320,240);x.fillStyle='white';x.font='24px sans-serif';x.fillText('SV storage test '+frame,20,120);},100);r.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};r.onstop=()=>{clearInterval(tick);s.getTracks().forEach(t=>t.stop());svLoadCapturedFront(new Blob(parts,{type:'video/webm'}));};r.start(100);setTimeout(()=>r.stop(),1500);}catch(e){window.__saveError=e.message;}})();true");
        stage("wait-replay-ready");
        until("!!latestReplayBlob && latestReplayBlob.size>0 && replay.videoWidth>0",30);
        until("!document.getElementById('svMobileSaveBtn').disabled",10);
        js("document.getElementById('svMobileSaveBtn').click();true");
        until("document.getElementById('svMobileSaveStatus').textContent.includes('Movies/SV MOBILE')",60);
        scenario.onActivity(a->{try(Cursor c=a.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Video.Media.SIZE,MediaStore.Video.Media.IS_PENDING},MediaStore.Video.Media.RELATIVE_PATH+"=?",new String[]{"Movies/SV MOBILE/"},MediaStore.Video.Media.DATE_ADDED+" DESC")){assertNotNull(c);assertTrue(c.moveToFirst());assertTrue(c.getLong(0)>0);assertEquals(0,c.getInt(1));}});
        stage("canvas-record-replay-and-mediastore-verified");
    }
    @Test public void aUnpaidCloudRequestDoesNotUpload()throws Exception{
        stage("unpaid-native-ready");
        until("!!window.__svNativeAdapter",60);
        js("window.__denial='';SVNative.onmessage=e=>window.__denial=JSON.parse(e.data);SVNative.postMessage(JSON.stringify({id:'denied',action:'begin',session:'test',mode:'cloud',mime:'video/webm',size:8}));true");
        until("!!window.__denial && window.__denial.ok===false",15);
    }
}
