package kr.co.tupgolf.svmobile;

import java.io.IOException;

/** Fail before checkout if the verifier and APK disagree about the sold product. */
final class ProductConfiguration {
    static void requireMatchingProduct(String expected, String configured) throws IOException {
        if (expected == null || expected.isEmpty() || !expected.equals(configured)) {
            throw new IOException("Pro 상품 연결이 일치하지 않습니다. 결제하지 않고 연결을 확인합니다.");
        }
    }
}
