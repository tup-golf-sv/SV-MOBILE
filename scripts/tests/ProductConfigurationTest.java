package kr.co.tupgolf.svmobile;

/** Standalone regression: javac -d classes ProductConfiguration.java ProductConfigurationTest.java */
public final class ProductConfigurationTest {
    public static void main(String[] args) throws Exception {
        ProductConfiguration.requireMatchingProduct("sv_mobile_pro", "sv_mobile_pro");
        for (String configured : new String[]{"other_product", "", null}) {
            try {
                ProductConfiguration.requireMatchingProduct("sv_mobile_pro", configured);
                throw new AssertionError("Checkout allowed with mismatched product: " + configured);
            } catch (java.io.IOException expected) { }
        }
        System.out.println("PASS: matching product accepted; wrong, missing and null product blocked");
    }
}
