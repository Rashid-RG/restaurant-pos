package com.rstechnologies.gastrofood;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Register only the customer-owned secure session plugin. Existing POS and
// driver applications have their own native project boundaries.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FoodSecureSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
