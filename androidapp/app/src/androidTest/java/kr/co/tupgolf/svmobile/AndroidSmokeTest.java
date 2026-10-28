package kr.co.tupgolf.svmobile;

import android.Manifest;
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
import static org.junit.Assert.*;

/** Emulator smoke tests. These do NOT prove real golfer detection or Play payments. */
@RunWith(AndroidJUnit4.class)
public class AndroidSmokeTest {
    @Rule public GrantPermissionRule permissions=GrantPermissionRule.grant(Manifest.permission.CAMERA,Manifest.permission.RECORD_AUDIO);
    private ActivityScenario<MainActivity> scenario;
    @Before public void launch(){scenario=ActivityScenario.launch(MainActivity.class);}
    @After public void close(){scenario.close();}
    private WebView find(View v){if(v instanceof WebView)return (WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=find(g.getChildAt(i));if(w!=null)return w;}}return null;}
    private String js(String source)throws Exception{
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(a->find(a.getWindow().getDecorView()).evaluateJavascript(source,r->{result.set(r);latch.countDown();}));
        assertTrue("JavaScript callback timed out",latch.await(15,TimeUnit.SECONDS));return result.get();
    }
    private void until(String expression,int seconds)throws Exception{
        long end=System.currentTimeMillis()+seconds*1000L;String result="";
        while(System.currentTimeMillis()<end){result=js(expression);if("true".equals(result))return;Thread.sleep(500);}
        fail("Timed out: "+expression+"; last="+result+"; status="+js("document.getElementById('status')?.textContent"));
    }
    @Test public void cameraReplayAndMediaStoreRoundTrip()throws Exception{
        until("!!window.__svNativeAdapter && typeof Pose==='function'",60);
        assertEquals("true",js("isSecureContext && !!navigator.mediaDevices.getUserMedia"));
        js("document.getElementById('connect').click();true");
        until("typeof stream!=='undefined' && !!stream && raw.videoWidth>0",60);
        // Model callback proves the unchanged model runs, not that a golfer was detected.
        until("typeof lastPoseRenderAt!=='undefined' && lastPoseRenderAt>0",120);
        js("window.__smokeError='';(async()=>{try{const r=new MediaRecorder(stream,{mimeType:'video/webm'}),parts=[];r.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};r.onstop=()=>svLoadCapturedFront(new Blob(parts,{type:'video/webm'}));r.start(100);setTimeout(()=>r.stop(),2000);}catch(e){window.__smokeError=e.message;}})();true");
        until("!!latestReplayBlob && latestReplayBlob.size>0 && replay.videoWidth>0",30);
        js("document.getElementById('svMobileSaveBtn').disabled=false;document.getElementById('svMobileSaveBtn').click();true");
        until("document.getElementById('svMobileSaveStatus').textContent.includes('Movies/SV MOBILE')",60);
        AtomicReference<String> saved=new AtomicReference<>();
        scenario.onActivity(a->{try(Cursor c=a.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Video.Media.SIZE,MediaStore.Video.Media.IS_PENDING},MediaStore.Video.Media.RELATIVE_PATH+"=?",new String[]{"Movies/SV MOBILE/"},MediaStore.Video.Media.DATE_ADDED+" DESC")){
            assertNotNull(c);assertTrue(c.moveToFirst());assertTrue(c.getLong(0)>0);assertEquals(0,c.getInt(1));saved.set("saved");
        }});assertEquals("saved",saved.get());
        android.graphics.Bitmap screen=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        java.io.File file=new java.io.File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"android-smoke.png");
        try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){screen.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
        js("document.getElementById('disconnect').click();true");
    }
    @Test public void unpaidCloudRequestDoesNotUpload()throws Exception{
        until("!!window.__svNativeAdapter",60);
        js("window.__denial='';SVNative.onmessage=e=>window.__denial=JSON.parse(e.data);SVNative.postMessage(JSON.stringify({id:'denied',action:'begin',session:'test',mode:'cloud',mime:'video/webm',size:8}));true");
        until("!!window.__denial && window.__denial.ok===false",15);
    }
}
