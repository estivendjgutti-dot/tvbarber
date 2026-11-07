package com.estiven4tech.tvlauncher

import android.app.admin.DeviceAdminReceiver

/**
 * Necessário só para o modo kiosk "de verdade" (lock task).
 * Ativação (box resetado, sem contas Google):
 *   adb shell dpm set-device-owner com.estiven4tech.tvlauncher/.AdminReceiver
 * Remoção: menu técnico da interface (Android.exitKiosk()) ou reset de fábrica.
 */
class AdminReceiver : DeviceAdminReceiver()
