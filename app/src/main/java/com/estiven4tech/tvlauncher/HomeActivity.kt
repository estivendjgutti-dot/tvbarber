package com.estiven4tech.tvlauncher

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Só existe para o papel de "tela inicial" (categoria HOME), que dá o autostart no boot.
 * Ela abre a MainActivity e fecha na hora.
 *
 * Fica separada porque o Samsung DeX recusa abrir uma Activity declarada como HOME
 * ("não pode ser executado no Samsung DeX, projetado para telas iniciais do telefone").
 * Assim a MainActivity (o player) abre normal no DeX, e o box continua com autostart.
 */
class HomeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        )
        finish()
        overridePendingTransition(0, 0)
    }
}
