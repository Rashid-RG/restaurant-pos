import UIKit
import Capacitor

// Registered only inside the generated GastroFlow Food iOS application.
// This does not alter the root POS or the driver application.
class GastroFoodViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GastroFoodSecureSessionPlugin())
    }
}
