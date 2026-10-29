package kr.co.tupgolf.svmobile;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

/** Drops late service callbacks after their Activity has been destroyed. */
final class LifecycleTasks {
    private final ExecutorService executor;
    private volatile boolean closed;
    LifecycleTasks(ExecutorService executor){this.executor=executor;}
    synchronized void submit(Runnable work){
        if(closed)return;
        try{executor.execute(()->{if(!closed)work.run();});}
        catch(RejectedExecutionException ignored){/* Activity teardown won the race. */}
    }
    synchronized void close(){closed=true;}
}
