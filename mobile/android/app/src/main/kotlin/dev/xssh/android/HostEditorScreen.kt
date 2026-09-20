package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.UUID

@Composable
fun HostEditorScreen(
    initial: Host?,
    onBack: () -> Unit,
    onSave: (Host) -> Unit,
    onDelete: ((Host) -> Unit)? = null,
) {
    val p = LocalXssh.current
    val defaultKeyPath = LocalContext.current.filesDir.resolve("xssh_dev_key").absolutePath

    var name by remember { mutableStateOf(initial?.name ?: "") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var port by remember { mutableStateOf((initial?.port ?: 22).toString()) }
    var username by remember { mutableStateOf(initial?.username ?: "") }
    var auth by remember { mutableStateOf(initial?.auth ?: AuthKind.KEY) }
    var keyPath by remember { mutableStateOf(initial?.keyPath?.takeIf { it.isNotBlank() } ?: defaultKeyPath) }
    var password by remember { mutableStateOf(initial?.password ?: "") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().background(p.bg).systemBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            XsshButton("‹ 返回", kind = ButtonKind.Ghost) { onBack() }
            Spacer(Modifier.weight(1f))
            Text(
                text = if (initial == null) "新建主机" else "编辑主机",
                color = p.text,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.weight(1f))
            XsshButton("保存") {
                if (address.isBlank()) {
                    error = "地址不能为空"
                } else {
                    error = null
                    val newAddress = address.trim()
                    val newPort = (port.toIntOrNull() ?: 22).coerceIn(1, 65535)
                    // 已信任的指纹是绑在「地址:端口」上的:改了目标就等于换了一台主机,
                    // 旧指纹不能跟着走(否则新主机会被误报成「密钥已改变」);没改就必须留下,
                    // 不然编辑一下备注就把信任关系抹了,下次连接又退回首次确认。
                    val sameEndpoint = initial != null &&
                        initial.address == newAddress && initial.port == newPort
                    onSave(
                        Host(
                            id = initial?.id ?: UUID.randomUUID().toString(),
                            name = name.trim(),
                            address = newAddress,
                            port = newPort,
                            username = username.trim(),
                            auth = auth,
                            keyPath = keyPath.trim(),
                            keyFingerprint = if (sameEndpoint) initial.keyFingerprint else "",
                            password = password,
                        ),
                    )
                }
            }
        }

        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            XsshCard {
                SectionLabel("基础")
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("名称") },
                    placeholder = { Text("生产机 / 家里 NAS") },
                    singleLine = true,
                    colors = xsshFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    label = { Text("地址") },
                    placeholder = { Text("192.168.1.10") },
                    singleLine = true,
                    colors = xsshFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                Row {
                    OutlinedTextField(
                        value = port,
                        onValueChange = { port = it.filter(Char::isDigit) },
                        label = { Text("端口") },
                        singleLine = true,
                        colors = xsshFieldColors(),
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(10.dp))
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("用户名") },
                        singleLine = true,
                        colors = xsshFieldColors(),
                        modifier = Modifier.weight(2f),
                    )
                }
            }

            XsshCard {
                SectionLabel("认证")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    KeyCap("私钥", active = auth == AuthKind.KEY) { auth = AuthKind.KEY }
                    KeyCap("密码", active = auth == AuthKind.PASSWORD) { auth = AuthKind.PASSWORD }
                }
                Spacer(Modifier.height(12.dp))
                if (auth == AuthKind.KEY) {
                    OutlinedTextField(
                        value = keyPath,
                        onValueChange = { keyPath = it },
                        label = { Text("私钥路径") },
                        singleLine = true,
                        colors = xsshFieldColors(),
                        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, color = p.text, fontSize = 13.sp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text("密钥库导入/生成在 M3 提供", color = p.textFaint, fontSize = 11.sp)
                } else {
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("密码") },
                        singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        colors = xsshFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text("密码仅保留在内存,不落盘", color = p.textFaint, fontSize = 11.sp)
                }
            }

            error?.let { Text(it, color = p.danger, fontSize = 13.sp) }

            if (initial != null && onDelete != null) {
                XsshButton("删除主机", kind = ButtonKind.Danger, modifier = Modifier.fillMaxWidth()) {
                    onDelete(initial)
                }
            }
        }
    }
}
