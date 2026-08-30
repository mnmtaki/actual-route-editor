package com.actualroute.editor;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentPickerPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setNavigationBarColor(Color.rgb(16, 19, 20));
    }
}