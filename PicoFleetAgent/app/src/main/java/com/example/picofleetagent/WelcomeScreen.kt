package com.example.picofleetagent

import android.app.Activity
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun WelcomeScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val activity = ctx as? Activity

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF00C853)) // green
            .padding(24.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.nexoria_logo),
                contentDescription = "NEXORIA Logo",
                modifier = Modifier.size(260.dp)
            )

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = "Welcome to NEXORIA",
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Quest Headset Management System",
                fontSize = 16.sp,
                color = Color.White
            )
        }

        // Bottom buttons (no overlap, no nesting)
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Button(
                onClick = {
                    ctx.startActivity(Intent(ctx, UpdatesActivity::class.java))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                Text("Updates", style = MaterialTheme.typography.titleMedium)
            }

            Button(
                onClick = {
                    // Hide welcome UI
                    onClose()

                    // Optional: app ko background me bhejna (agar tum chaho)
                    // activity?.moveTaskToBack(true)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                Text("Close", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
